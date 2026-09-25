"""Uploads, file downloads, the realtime socket and the health check."""
from __future__ import annotations

import asyncio
import contextlib
import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..config import settings
from ..db import SessionLocal, get_db
from ..models import User
from ..realtime import hub
from ..security import COOKIE_NAME, STAFF_ROLES, optional_user, rate_limit, user_from_token

router = APIRouter(tags=["system"])

# Who may upload into each area. None = anyone, so applicants can attach payment proofs before they have an account.
UPLOAD_ROLES: dict[str, set[str] | None] = {
    "payment-proofs": None, "registrations": None,
    "submissions": {"student", *STAFF_ROLES}, "avatars": {"student", *STAFF_ROLES},
    "uploads": set(STAFF_ROLES), "gallery": {"director", "admin", "superadmin"},
    "documents": {"director", "admin", "superadmin", "teacher"}, "news": {"director", "admin", "superadmin"},
    "library-files": {"director", "admin", "superadmin", "teacher"},
    "library-covers": {"director", "admin", "superadmin", "teacher"},
}
# Staff roles that may open other people's private files in each area.
PRIVATE_READERS = {
    "payment-proofs": {"accounts", "admin", "superadmin", "director"},
    "registrations": {"accounts", "admin", "superadmin", "director"},
    "submissions": {"teacher", "admin", "superadmin", "director"},
}
_anon_upload_limit = rate_limit("anon-upload", 60, 900)


async def _read_body(request: Request, limit: int) -> bytes:
    """Read the raw request body, stopping early if it exceeds `limit` bytes."""
    if int(request.headers.get("content-length") or 0) > limit:
        raise HTTPException(413, "File too large.")
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, "File too large.")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/api/upload/{bucket}/{filename}")
async def upload(bucket: str, filename: str, request: Request, user: User | None = Depends(optional_user)):
    """The browser sends the file itself as the request body; returns the stored file's URL."""
    if bucket not in UPLOAD_ROLES:
        raise HTTPException(400, "Unknown upload area.")
    allowed = UPLOAD_ROLES[bucket]
    if allowed is None:
        if user is None:
            await _anon_upload_limit(request)
    elif user is None:
        raise HTTPException(401, "Please log in to upload files.")
    elif user.role not in allowed:
        raise HTTPException(403, "You cannot upload to this area.")
    data = await _read_body(request, settings.max_upload_mb * 1024 * 1024)
    url = await storage.save(bucket, filename, data, user.id if user else None)
    return {"url": url, "bucket": bucket}


def _file_response(request: Request, data: bytes, ctype: str, cache: str) -> Response:
    etag = '"' + hashlib.md5(data, usedforsecurity=False).hexdigest() + '"'
    headers = {"Cache-Control": cache, "ETag": etag, "Content-Disposition": "inline",
               "X-Content-Type-Options": "nosniff"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type=ctype, headers=headers)


@router.get("/files/{bucket}/{name}")
async def public_file(bucket: str, name: str, request: Request):
    if bucket not in storage.PUBLIC_BUCKETS:
        raise HTTPException(404, "File not found.")
    data, ctype = await storage.read(bucket, name)
    # File names are unique per upload, so the content never changes: cache it for a year.
    return _file_response(request, data, ctype, "public, max-age=31536000, immutable")


@router.get("/api/files/{bucket}/{name}")
async def private_file(bucket: str, name: str, request: Request, user: User | None = Depends(optional_user)):
    if user is None:
        raise HTTPException(401, "Please log in.")
    if bucket not in storage.PRIVATE_BUCKETS:
        raise HTTPException(404, "File not found.")
    if user.role not in PRIVATE_READERS.get(bucket, set()) and storage.owner_of(name) != user.id:
        raise HTTPException(404, "File not found.")
    data, ctype = await storage.read(bucket, name)
    return _file_response(request, data, ctype, "private, max-age=3600")


@router.get("/api/health")
async def health(db: AsyncSession = Depends(get_db)):
    """Used by the host and uptime monitor. Touches the database so a sleeping free-tier DB stays awake."""
    await db.execute(text("SELECT 1"))
    return {"ok": True, "online_users": hub.online_users}


@router.websocket("/ws")
async def websocket(ws: WebSocket):
    """Realtime channel. The browser authenticates with its session cookie, then only listens."""
    async with SessionLocal() as db:
        user = await user_from_token(ws.cookies.get(COOKIE_NAME), db)
    if user is None:
        await ws.close(code=4401)
        return
    await ws.accept()
    hub.add(ws, user.id, user.role)
    try:
        while True:
            # Clients send "ping" every ~25 s; a socket silent for 90 s is considered gone.
            if await asyncio.wait_for(ws.receive_text(), timeout=90) == "ping":
                await ws.send_text('{"event":"pong"}')
    except (WebSocketDisconnect, asyncio.TimeoutError, RuntimeError):
        pass
    finally:
        hub.remove(ws, user.id, user.role)
        with contextlib.suppress(Exception):
            await ws.close()
