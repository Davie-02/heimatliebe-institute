"""Authentication, authorisation, rate limiting and audit helpers."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import anyio
import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_db
from .models import AuditLog, User

COOKIE_NAME = "hmli_session"
STAFF_ROLES = frozenset({"teacher", "accounts", "hr", "director", "admin", "superadmin"})
ADMIN_ROLES = frozenset({"admin", "superadmin"})
MANAGEMENT_ROLES = frozenset({"director", "admin", "superadmin"})
_LEGACY_SALT = "hmli_salt_2025"


# ── Passwords ────────────────────────────────────────────────────────────
def _hash_sync(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=11)).decode()


def _verify_sync(password: str, hashed: str) -> bool:
    if not hashed:
        return False
    if hashed.startswith("$2"):
        try:
            return bcrypt.checkpw(password.encode()[:72], hashed.encode())
        except ValueError:
            return False
    # Legacy SHA-256 hashes from the first version of the site (re-hashed on next login).
    legacy = hashlib.sha256((password + _LEGACY_SALT).encode()).hexdigest()
    return hmac.compare_digest(legacy, hashed)


# Checked against when a login ID doesn't exist, so timing doesn't reveal valid accounts.
DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt(rounds=11)).decode()


async def hash_password(password: str) -> str:
    # bcrypt is CPU-bound; keep it off the event loop so other requests stay fast.
    return await anyio.to_thread.run_sync(_hash_sync, password)


async def verify_password(password: str, hashed: str) -> bool:
    return await anyio.to_thread.run_sync(_verify_sync, password, hashed)


def needs_rehash(hashed: str) -> bool:
    return not hashed.startswith("$2")


def validate_new_password(password: str) -> None:
    if not isinstance(password, str) or len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if len(password.encode()) > 72:
        raise HTTPException(400, "Password is too long (max 72 bytes).")


def temp_password() -> str:
    return "hmli-" + secrets.token_hex(4)


# ── Sessions ─────────────────────────────────────────────────────────────
def _password_version(user: User) -> str:
    # Changing the password changes this, which invalidates every existing session.
    return hashlib.sha256(user.password_hash.encode()).hexdigest()[:10]


def create_session_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.session_hours)
    payload = {"sub": user.id, "role": user.role, "pv": _password_version(user), "exp": exp}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def set_session_cookie(response, request: Request, token: str) -> None:
    secure = settings.cookie_secure or request.url.scheme == "https" or \
        request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(
        COOKIE_NAME, token, max_age=settings.session_hours * 3600,
        httponly=True, samesite="lax", secure=secure, path="/",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def _token_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(COOKIE_NAME)


# Tiny TTL cache so a burst of API calls from one page costs one user lookup.
_user_cache: dict[str, tuple[float, User]] = {}
_USER_CACHE_TTL = 5.0


def forget_user(user_id: str) -> None:
    _user_cache.pop(user_id, None)


async def user_from_token(token: str | None, db: AsyncSession) -> User | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    uid = payload.get("sub")
    cached = _user_cache.get(uid)
    if cached and cached[0] > time.monotonic():
        user = cached[1]
    else:
        user = await db.get(User, uid)
        if user is None:
            return None
        db.expunge(user)
        _user_cache[uid] = (time.monotonic() + _USER_CACHE_TTL, user)
    if user.status not in ("active", "graduated") or payload.get("pv") != _password_version(user):
        return None
    return user


async def optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    user = await user_from_token(_token_from_request(request), db)
    request.state.user = user
    return user


async def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(401, "Not authenticated. Please log in.")
    return user


def require_roles(*roles: str):
    allowed = set(roles) | {"superadmin"}

    async def dep(user: User = Depends(current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(403, "You do not have permission for this action.")
        return user

    return dep


require_staff = require_roles(*STAFF_ROLES)
require_admin = require_roles(*ADMIN_ROLES)
require_management = require_roles(*MANAGEMENT_ROLES)


# ── Rate limiting (per client IP, in-memory sliding window) ──────────────
_hits: dict[tuple[str, str], deque] = defaultdict(deque)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, limit: int, window_seconds: int):
    async def dep(request: Request) -> None:
        key = (bucket, client_ip(request))
        now = time.monotonic()
        q = _hits[key]
        while q and q[0] <= now - window_seconds:
            q.popleft()
        if len(q) >= limit:
            retry = int(window_seconds - (now - q[0])) + 1
            raise HTTPException(429, f"Too many attempts. Try again in {retry} seconds.",
                                headers={"Retry-After": str(retry)})
        q.append(now)

    return dep


def _check(key: tuple[str, str], limit: int, window: int, record: bool) -> None:
    now = time.monotonic()
    q = _hits[key]
    while q and q[0] <= now - window:
        q.popleft()
    if len(q) >= limit:
        retry = int(window - (now - q[0])) + 1
        raise HTTPException(429, f"Too many failed attempts. Try again in {retry} seconds.",
                            headers={"Retry-After": str(retry)})
    if record:
        q.append(now)


def login_guard(request: Request, login: str) -> None:
    """Block brute force without locking out a whole classroom that shares one public IP."""
    ip = client_ip(request)
    _check(("login-fail", f"{ip}|{login.lower()}"), 5, 900, record=False)   # per account + IP
    _check(("login-fail-ip", ip), 100, 900, record=False)                   # per IP (NAT'd lab / office)


def login_failed(request: Request, login: str) -> None:
    ip = client_ip(request)
    _hits[("login-fail", f"{ip}|{login.lower()}")].append(time.monotonic())
    _hits[("login-fail-ip", ip)].append(time.monotonic())


def reset_rate_limits() -> None:
    _hits.clear()


# ── Audit trail ──────────────────────────────────────────────────────────
async def audit(db: AsyncSession, request: Request | None, user: User | None, action: str,
                entity: str | None = None, entity_id: str | None = None, details: dict | None = None) -> None:
    db.add(AuditLog(
        user_id=user.id if user else None, action=action, entity=entity, entity_id=entity_id,
        details=details, ip=client_ip(request) if request else None,
    ))


async def find_login_user(db: AsyncSession, login: str) -> User | None:
    login = (login or "").strip()
    if not login:
        return None
    if "@" in login:
        stmt = select(User).where(User.email == login.lower())
    else:
        stmt = select(User).where(User.user_id == login.upper())
    return (await db.execute(stmt.limit(1))).scalar_one_or_none()
