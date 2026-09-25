"""Integrations with Google Workspace and other calendar / identity providers.

* Calendar feeds (.ics): each user gets a private subscription link that works in Google Calendar,
  Outlook, Apple Calendar and phone calendars. It contains their timetable (weekly repeating),
  exams, assignment deadlines and academic calendar events, and refreshes automatically.
* "Sign in with Google": optional OAuth 2.0 / OpenID Connect login for people whose email address
  already belongs to an account (no self-registration). Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET,
  and GOOGLE_WORKSPACE_DOMAIN to allow only the institute's Workspace domain.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import services
from ..config import settings
from ..db import get_db
from ..models import Assignment, Class, ClassEnrollment, Event, Exam, TimetableEntry, User
from ..security import audit, create_session_token, current_user, forget_user, set_session_cookie

router = APIRouter(tags=["integrations"])


# ── Calendar feeds ───────────────────────────────────────────────────────
def calendar_token(user_id: str) -> str:
    """Unguessable, stateless token: the user id plus an HMAC of it. Rotating SECRET_KEY revokes all links."""
    sig = hmac.new(settings.secret_key.encode(), f"ics:{user_id}".encode(), hashlib.sha256).hexdigest()[:32]
    return f"{user_id}.{sig}"


def _user_from_calendar_token(token: str) -> str | None:
    user_id, _, _sig = token.partition(".")
    return user_id if user_id and hmac.compare_digest(calendar_token(user_id), token) else None


@router.get("/api/calendar/link")
async def calendar_link(request: Request, user: User = Depends(current_user)):
    base = settings.site_url or str(request.base_url).rstrip("/")
    url = f"{base}/calendar/{calendar_token(user.id)}.ics"
    return {"url": url, "google": "https://calendar.google.com/calendar/r?cid=" + url.replace("https://", "webcal://")}


def _ics_text(v: str) -> str:
    return (v or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    """RFC 5545 lines longer than 75 octets are folded with CRLF + space."""
    out, raw = [], line.encode()
    while len(raw) > 75:
        cut = 75
        while (raw[cut] & 0xC0) == 0x80:  # don't split a UTF-8 character
            cut -= 1
        out.append(raw[:cut].decode()); raw = raw[cut:]
    out.append(raw.decode())
    return "\r\n ".join(out)


def _dt(v: datetime) -> str:
    v = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    return v.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


@router.get("/calendar/{token}.ics")
async def calendar_feed(token: str, db: AsyncSession = Depends(get_db)):
    user_id = _user_from_calendar_token(token)
    user = await db.get(User, user_id) if user_id else None
    if not user or user.status not in ("active", "graduated"):
        raise HTTPException(404, "Calendar not found.")
    inst = await services.get_setting(db, "institution")
    if user.role == "student":
        class_ids = select(ClassEnrollment.class_id).where(ClassEnrollment.user_id == user.id,
                                                           ClassEnrollment.status == "active")
    elif user.role == "teacher":
        class_ids = select(Class.id).where(Class.teacher_id == user.id)
    else:
        class_ids = select(Class.id).where(Class.status == "active")
    stamp = _dt(datetime.now(timezone.utc))
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Heimatliebe Institute//Portal//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{_ics_text(inst['name'])}", "X-WR-TIMEZONE:Africa/Blantyre",
             "REFRESH-INTERVAL;VALUE=DURATION:PT6H"]

    def event(uid_: str, summary: str, start: str, end: str | None = None, extra: list[str] = ()):
        lines.extend(["BEGIN:VEVENT", f"UID:{uid_}@heimatliebe", f"DTSTAMP:{stamp}", start, *( [end] if end else []),
                      f"SUMMARY:{_ics_text(summary)}", *extra, "END:VEVENT"])

    # Weekly classes: the first occurrence on/after today, repeating every week (local Malawi time).
    weekday_codes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
    rows = (await db.execute(select(TimetableEntry, Class).join(Class, Class.id == TimetableEntry.class_id)
                             .where(TimetableEntry.class_id.in_(class_ids)))).all()
    today = date.today()
    for entry, cls in rows:
        offset = (entry.day_of_week - (today.weekday() + 1) % 7) % 7
        first = today + timedelta(days=offset)
        start = first.strftime("%Y%m%d") + "T" + entry.start_time.replace(":", "") + "00"
        end = first.strftime("%Y%m%d") + "T" + entry.end_time.replace(":", "") + "00"
        until = f";UNTIL={cls.end_date:%Y%m%d}T235959Z" if cls.end_date else ""
        extra = [f"RRULE:FREQ=WEEKLY;BYDAY={weekday_codes[entry.day_of_week]}{until}"]
        if entry.room:
            extra.append(f"LOCATION:{_ics_text('Room ' + entry.room)}")
        if cls.meeting_url:
            extra.append(f"URL:{cls.meeting_url}")
        event(f"tt-{entry.id}", cls.name, f"DTSTART;TZID=Africa/Blantyre:{start}", f"DTEND;TZID=Africa/Blantyre:{end}", extra)

    for ex in (await db.execute(select(Exam).where(Exam.class_id.in_(class_ids), Exam.published.is_(True),
                                                   Exam.date.is_not(None)))).scalars():
        end = ex.date + timedelta(minutes=ex.duration_minutes or 60)
        event(f"exam-{ex.id}", f"Exam: {ex.title}", f"DTSTART:{_dt(ex.date)}", f"DTEND:{_dt(end)}")
    for a in (await db.execute(select(Assignment).where(Assignment.class_id.in_(class_ids), Assignment.published.is_(True),
                                                        Assignment.due_date.is_not(None)))).scalars():
        event(f"due-{a.id}", f"Due: {a.title}", f"DTSTART:{_dt(a.due_date)}", f"DTEND:{_dt(a.due_date)}")
    for ev in (await db.execute(select(Event).where(Event.start_date >= today - timedelta(days=90)))).scalars():
        last = (ev.end_date or ev.start_date) + timedelta(days=1)  # all-day events end exclusive
        event(f"ev-{ev.id}", ev.title, f"DTSTART;VALUE=DATE:{ev.start_date:%Y%m%d}", f"DTEND;VALUE=DATE:{last:%Y%m%d}",
              [f"DESCRIPTION:{_ics_text(ev.description or '')}"] if ev.description else [])
    lines.append("END:VCALENDAR")
    body = "\r\n".join(_fold(l) for l in lines) + "\r\n"
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "private, max-age=900", "Content-Disposition": 'inline; filename="heimatliebe.ics"'})


# ── Sign in with Google ──────────────────────────────────────────────────
STATE_COOKIE = "hmli_oauth_state"


def _redirect_uri(request: Request) -> str:
    return (settings.site_url or str(request.base_url).rstrip("/")) + "/api/auth/google/callback"


@router.get("/api/auth/google/start")
async def google_start(request: Request):
    if not settings.google_enabled:
        raise HTTPException(404, "Google sign-in is not enabled.")
    state = secrets.token_urlsafe(24)
    params = {"client_id": settings.google_client_id, "redirect_uri": _redirect_uri(request), "response_type": "code",
              "scope": "openid email profile", "state": state, "prompt": "select_account"}
    if settings.google_workspace_domain:
        params["hd"] = settings.google_workspace_domain
    resp = RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params))
    # The state cookie ties the callback to this browser (protects against login CSRF).
    resp.set_cookie(STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax", secure=request.url.scheme == "https")
    return resp


@router.get("/api/auth/google/callback")
async def google_callback(request: Request, code: str = "", state: str = "", db: AsyncSession = Depends(get_db)):
    fail = lambda msg: RedirectResponse("/login.html?error=" + urlencode({"m": msg})[2:])
    if not settings.google_enabled:
        raise HTTPException(404, "Google sign-in is not enabled.")
    if not code or not state or not hmac.compare_digest(state, request.cookies.get(STATE_COOKIE, "")):
        return fail("Google sign-in expired. Please try again.")
    async with httpx.AsyncClient(timeout=15) as client:
        tok = await client.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
            "redirect_uri": _redirect_uri(request), "grant_type": "authorization_code"})
        if tok.status_code != 200:
            return fail("Google sign-in failed. Please try again.")
        # Google validates the ID token's signature for us; we then check who it was issued for.
        info = (await client.get("https://oauth2.googleapis.com/tokeninfo",
                                 params={"id_token": tok.json().get("id_token", "")})).json()
    email = (info.get("email") or "").lower()
    if info.get("aud") != settings.google_client_id or info.get("email_verified") not in ("true", True) or not email:
        return fail("Google could not confirm your email address.")
    if settings.google_workspace_domain and info.get("hd") != settings.google_workspace_domain:
        return fail(f"Please use your @{settings.google_workspace_domain} account.")
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user or user.status not in ("active", "graduated"):
        return fail("No active account uses this Google email. Ask the office to add it to your profile.")
    user.last_login_at = services.utcnow()
    await audit(db, request, user, "login.google", "users", user.id)
    await db.commit()
    forget_user(user.id)
    resp = RedirectResponse("/login.html?sso=1")
    set_session_cookie(resp, request, create_session_token(user))
    resp.delete_cookie(STATE_COOKIE)
    return resp
