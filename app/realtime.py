"""Realtime push over WebSockets.

Each browser tab opens one socket (`/ws`). Events are addressed to user IDs or roles.
With one worker everything stays in-process; set REDIS_URL to fan out across several workers.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from collections import defaultdict

import orjson
from fastapi import WebSocket

from .config import settings

log = logging.getLogger("hmli.realtime")
_CHANNEL = "hmli:events"


class Hub:
    def __init__(self) -> None:
        self.by_user: dict[str, set[WebSocket]] = defaultdict(set)
        self.by_role: dict[str, set[WebSocket]] = defaultdict(set)
        self._redis = None
        self._listener: asyncio.Task | None = None

    # ── connections ──
    def add(self, ws: WebSocket, user_id: str, role: str) -> None:
        self.by_user[user_id].add(ws)
        self.by_role[role].add(ws)

    def remove(self, ws: WebSocket, user_id: str, role: str) -> None:
        self.by_user[user_id].discard(ws)
        self.by_role[role].discard(ws)
        if not self.by_user[user_id]:
            self.by_user.pop(user_id, None)

    @property
    def online_users(self) -> int:
        return len(self.by_user)

    # ── publishing ──
    async def publish(self, event: str, data: dict | None = None, *, users=(), roles=()) -> None:
        msg = {"event": event, "data": data or {}, "users": list(users), "roles": list(roles)}
        if self._redis is not None:
            try:
                await self._redis.publish(_CHANNEL, orjson.dumps(msg))
                return
            except Exception as exc:  # fall back to local delivery
                log.warning("redis publish failed: %s", exc)
        await self._deliver(msg)

    async def _deliver(self, msg: dict) -> None:
        targets: set[WebSocket] = set()
        for uid in msg.get("users") or ():
            targets |= self.by_user.get(uid, set())
        for role in msg.get("roles") or ():
            targets |= self.by_role.get(role, set())
            if role in ("admin",):  # superadmins see everything admins see
                targets |= self.by_role.get("superadmin", set())
        if not targets:
            return
        payload = orjson.dumps({"event": msg["event"], "data": msg["data"]}).decode()
        results = await asyncio.gather(*(ws.send_text(payload) for ws in targets), return_exceptions=True)
        if any(isinstance(r, Exception) for r in results):
            log.debug("dropped %d dead sockets", sum(isinstance(r, Exception) for r in results))

    # ── lifecycle ──
    async def start(self) -> None:
        if not settings.redis_url:
            return
        try:
            import redis.asyncio as redis  # optional dependency
        except ImportError:
            log.warning("REDIS_URL set but the 'redis' package is not installed; realtime stays in-process")
            return
        self._redis = redis.from_url(settings.redis_url)
        self._listener = asyncio.create_task(self._listen())

    async def _listen(self) -> None:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(_CHANNEL)
        async for item in pubsub.listen():
            if item.get("type") == "message":
                with contextlib.suppress(Exception):
                    await self._deliver(orjson.loads(item["data"]))

    async def stop(self) -> None:
        if self._listener:
            self._listener.cancel()
        if self._redis is not None:
            await self._redis.aclose()


hub = Hub()
