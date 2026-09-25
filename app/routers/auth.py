"""Login, logout, session info, profile and password management."""
from __future__ import annotations

import hashlib
import html
import secrets
from datetime import timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import mailer, services
from ..config import settings
from ..db import get_db
from ..models import PasswordResetToken, User
from ..responses import JSONResponse
from ..security import (
    DUMMY_HASH, audit, clear_session_cookie, create_session_token, current_user, find_login_user, forget_user,
    hash_password, login_failed, login_guard, needs_rehash, optional_user, rate_limit, set_session_cookie,
    validate_new_password, verify_password,
)

router = APIRouter(tags=["auth"])

SAFE_USER_FIELDS = ("id", "user_id", "full_name", "email", "phone", "role", "status", "course", "level",
                    "department", "staff_id", "photo_url", "date_of_birth", "gender", "nationality", "address",
                    "guardian_name", "guardian_phone", "must_change_password", "created_at", "last_login_at")


def public_user(u: User) -> dict:
    d = {f: getattr(u, f) for f in SAFE_USER_FIELDS}
    d["student_id"] = u.user_id if u.role == "student" else None
    return d


class LoginIn(BaseModel):
    user_id: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=200)


@router.post("/api/login")
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    login_guard(request, body.user_id)
    user = await find_login_user(db, body.user_id)
    # Always run a bcrypt check so response time doesn't reveal whether the account exists.
    ok = await verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if not user or not ok:
        login_failed(request, body.user_id)
        raise HTTPException(401, "Invalid login ID or password.")
    if user.status not in ("active", "graduated"):
        raise HTTPException(403, "This account is not active. Please contact the institute.")
    if needs_rehash(user.password_hash):
        user.password_hash = await hash_password(body.password)
    user.last_login_at = services.utcnow()
    await audit(db, request, user, "login", "users", user.id)
    await db.commit()
    forget_user(user.id)
    resp = JSONResponse({"user": public_user(user)})
    set_session_cookie(resp, request, create_session_token(user))
    return resp


@router.post("/api/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    clear_session_cookie(resp)
    return resp


@router.get("/api/session")
async def session_info(user: User | None = Depends(optional_user)):
    """Like /api/me but never 401 — public pages use it to check whether someone is signed in."""
    return JSONResponse({"user": public_user(user) if user else None})


@router.get("/api/me")
async def me(user: User = Depends(current_user)):
    return JSONResponse({"user": public_user(user)})


class ProfileIn(BaseModel):
    phone: str | None = Field(None, max_length=40)
    email: str | None = Field(None, max_length=254)
    address: str | None = Field(None, max_length=500)
    photo_url: str | None = Field(None, max_length=1000)
    guardian_name: str | None = Field(None, max_length=200)
    guardian_phone: str | None = Field(None, max_length=40)


@router.patch("/api/me")
async def update_me(body: ProfileIn, request: Request, user: User = Depends(current_user),
                    db: AsyncSession = Depends(get_db)):
    values = body.model_dump(exclude_unset=True)
    if "email" in values and values["email"]:
        values["email"] = values["email"].strip().lower()
        if "@" not in values["email"]:
            raise HTTPException(400, "Please enter a valid email address.")
    if values:
        await db.execute(update(User).where(User.id == user.id).values(**values, updated_at=services.utcnow()))
        await audit(db, request, user, "profile.update", "users", user.id, {"fields": sorted(values)})
        await db.commit()
        forget_user(user.id)
    fresh = await db.get(User, user.id)
    return JSONResponse({"user": public_user(fresh)})


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str


@router.post("/api/change-password", dependencies=[Depends(rate_limit("change-pw", 10, 300))])
async def change_password(body: ChangePasswordIn, request: Request, user: User = Depends(current_user),
                          db: AsyncSession = Depends(get_db)):
    validate_new_password(body.new_password)
    fresh = await db.get(User, user.id)
    if not await verify_password(body.old_password, fresh.password_hash):
        raise HTTPException(401, "Current password is incorrect.")
    fresh.password_hash = await hash_password(body.new_password)
    fresh.must_change_password = False
    await audit(db, request, user, "password.change", "users", user.id)
    await db.commit()
    forget_user(user.id)
    resp = JSONResponse({"ok": True})
    set_session_cookie(resp, request, create_session_token(fresh))  # keep this tab signed in
    return resp


class ResetRequestIn(BaseModel):
    student_id: str = Field(max_length=254)
    email: str = Field(max_length=254)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.post("/api/request-password-reset", dependencies=[Depends(rate_limit("reset-req", 5, 900))])
async def request_password_reset(body: ResetRequestIn, request: Request, background: BackgroundTasks,
                                 db: AsyncSession = Depends(get_db)):
    stmt = select(User).where(User.user_id == body.student_id.strip().upper(),
                              User.email == body.email.strip().lower())
    user = (await db.execute(stmt)).scalar_one_or_none()
    if user:
        token = secrets.token_urlsafe(32)
        db.add(PasswordResetToken(user_id=user.id, token_hash=_token_hash(token),
                                  expires_at=services.utcnow() + timedelta(hours=1)))
        await db.commit()
        site = settings.site_url or str(request.base_url).rstrip("/")
        link = f"{site}/reset-password.html?token={token}&id={user.user_id}"
        body_html = (f"<p>A password reset was requested for your account <strong>{html.escape(user.user_id)}</strong>."
                     f" The link below expires in 1 hour.</p>{mailer.button(link, 'Reset Password')}"
                     "<p>If you didn't request this, you can ignore this email.</p>")
        background.add_task(mailer.send_email, user.email, "Reset your password — Heimatliebe Institute",
                            mailer.layout("Password Reset", f"Hi {user.full_name},", body_html))
    return {"ok": True, "message": "If that ID and email match an account, a reset link has been sent."}


class ResetIn(BaseModel):
    token: str
    student_id: str
    new_password: str


@router.post("/api/reset-password", dependencies=[Depends(rate_limit("reset", 10, 900))])
async def reset_password(body: ResetIn, request: Request, db: AsyncSession = Depends(get_db)):
    validate_new_password(body.new_password)
    stmt = select(PasswordResetToken, User).join(User, User.id == PasswordResetToken.user_id).where(
        PasswordResetToken.token_hash == _token_hash(body.token), PasswordResetToken.used.is_(False),
        User.user_id == body.student_id.strip().upper())
    row = (await db.execute(stmt)).first()
    if not row:
        raise HTTPException(400, "Invalid or already-used reset link.")
    token, user = row
    expires = token.expires_at if token.expires_at.tzinfo else token.expires_at.replace(tzinfo=timezone.utc)
    if expires < services.utcnow():
        raise HTTPException(400, "This reset link has expired. Please request a new one.")
    user.password_hash = await hash_password(body.new_password)
    user.must_change_password = False
    token.used = True
    await audit(db, request, user, "password.reset", "users", user.id)
    await db.commit()
    forget_user(user.id)
    return {"ok": True, "message": "Your password has been reset. You can now log in."}
