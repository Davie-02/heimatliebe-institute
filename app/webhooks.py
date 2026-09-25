"""Outgoing webhooks for third-party automation (Zapier, Make, n8n, Google Apps Script …).

Deliveries run in the background after the database transaction commits, so a slow or broken
receiver never delays the user. Each request carries:

    Content-Type: application/json
    X-Heimatliebe-Event: application.new
    X-Heimatliebe-Signature: sha256=<HMAC-SHA256 of the raw body, keyed with the webhook's secret>

Body: {"event": "...", "data": {...}, "sent_at": "<ISO time>"}
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import time
from datetime import datetime, timezone

import httpx
import orjson
from sqlalchemy import select, update

from .db import SessionLocal
from .models import Webhook

log = logging.getLogger("hmli.webhooks")

# Events an administrator can subscribe to. Private events (chat messages, personal notifications) are never sent out.
EVENTS = {
    "application.new": "A new online application was submitted",
    "application.approved": "An application was approved and a student account created",
    "enquiry.new": "A new enquiry arrived from the website",
    "placement.new": "Someone completed the online placement test",
    "payment.new": "A student reported a payment",
    "payment.confirmed": "Accounts confirmed a payment",
    "exam_registration.new": "Someone registered for an official exam",
    "certificate.issued": "A certificate was issued",
    "leave.new": "A staff member requested leave",
}

_cache: tuple[float, list[Webhook]] | None = None


async def _active_hooks() -> list[Webhook]:
    """Webhooks are read at most once a minute; admins rarely change them."""
    global _cache
    if _cache and _cache[0] > time.monotonic():
        return _cache[1]
    async with SessionLocal() as db:
        hooks = list((await db.execute(select(Webhook).where(Webhook.active.is_(True)))).scalars())
    _cache = (time.monotonic() + 60, hooks)
    return hooks


def forget_cache() -> None:
    global _cache
    _cache = None


def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def _deliver(hook: Webhook, event: str, body: bytes) -> None:
    status = "error"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(hook.url, content=body, headers={
                "Content-Type": "application/json", "User-Agent": "Heimatliebe-Webhooks/1.0",
                "X-Heimatliebe-Event": event, "X-Heimatliebe-Signature": sign(hook.secret, body)})
        status = f"{r.status_code}"
    except httpx.HTTPError as exc:
        status = f"failed: {type(exc).__name__}"
        log.warning("webhook %s failed: %s", hook.name, exc)
    async with SessionLocal() as db:
        await db.execute(update(Webhook).where(Webhook.id == hook.id)
                         .values(last_status=status, last_sent_at=datetime.now(timezone.utc)))
        await db.commit()


async def dispatch(event: str, data: dict) -> None:
    if event not in EVENTS:
        return
    hooks = [h for h in await _active_hooks() if h.events.strip() == "*" or event in
             {e.strip() for e in h.events.split(",")}]
    if not hooks:
        return
    body = orjson.dumps({"event": event, "data": data, "sent_at": datetime.now(timezone.utc).isoformat()})
    await asyncio.gather(*(_deliver(h, event, body) for h in hooks), return_exceptions=True)
