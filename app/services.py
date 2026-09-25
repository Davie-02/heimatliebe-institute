"""Business logic shared by the API routers and the generic data API."""
from __future__ import annotations

import asyncio
import secrets
import time
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import event as sa_event, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from .models import (
    Certificate, ClassEnrollment, Invoice, Notification, Payment, Setting, User, uid,
)
from . import webhooks
from .realtime import hub

DEFAULT_SETTINGS = {
    "institution": {
        "name": "Heimatliebe Institute",
        "tagline": "Private International Language School",
        "location": "Karonga, Malawi",
        "currency": "MWK",
        "current_term": "Term 1",
        "academic_year": str(date.today().year),
        "pass_mark": 50,
        "attendance_alert_threshold": 75,
        "phone": "+265 991 383 466",
        "email": "info@heimatliebe.mw",
        "languages": ["German", "French", "Swahili", "Spanish", "Chinese", "Latin", "English"],
        "levels": ["A1", "A2", "B1", "B2", "C1", "C2"],
        "application_fee": 0,
        "enrolment_open": True,
    },
    # Homepage text, editable by admins under Website → Homepage content. Defaults are the current wording.
    "site": {
        "hero_words": ["Welcome to", "Heimatliebe", "Institute", "Language", "Connects!"],
        "hero_label": "German · A1 – B2 · Karonga, Malawi",
        "hero_location": "Private International Language School",
        "hero_tagline": "Empowering Malawians with foreign language skills that open doors to education, employment, and the world.",
        "about_title": "Language education rooted in Malawi, reaching the world.",
        "about_body": ("Heimatliebe Institute is a private international language school based in Karonga, in the Northern Region "
                       "of Malawi. We exist to deliver high-quality foreign language education that is accessible, practical, "
                       "and career-defining.\n\nOur name reflects our belief: that a love of one's homeland and the drive to connect "
                       "with the wider world are not opposites — they strengthen each other. We give Malawians the linguistic tools "
                       "to engage confidently in education, travel, employment, and culture across borders.\n\nCurrently offering "
                       "German at levels A1 through B2, we are building toward becoming a comprehensive multilingual centre and a "
                       "certified language examination hub — so that Malawians no longer need to travel abroad to sit for "
                       "internationally recognised language qualifications."),
        "stats": [{"num": "A1–B2", "label": "German levels currently offered"},
                  {"num": "6", "label": "Languages in the expansion plan"},
                  {"num": "7", "label": "Core programme goals"}],
        "goals_title": "Seven goals that drive our programme.",
        "goals_intro": "Every course we design, every student we enrol, and every partnership we build is guided by these commitments.",
        "goals": [
            {"icon": "graduation", "title": "Study Abroad Support", "text": "We prepare students with the language proficiency needed to gain admission to — and succeed in — academic programmes in German-speaking countries and beyond."},
            {"icon": "briefcase", "title": "Workforce Preparation", "text": "For those planning to work abroad, our courses build real workplace communication skills, improving job prospects and supporting Malawi's economy through remittances."},
            {"icon": "plane", "title": "Travel Confidence", "text": "We equip travellers with practical language knowledge and cultural context so they can navigate new environments with ease and confidence."},
            {"icon": "globe", "title": "Tourism Growth", "text": "Graduates can serve as interpreters or certified tour guides, contributing directly to Malawi's growing tourism sector and the local economy."},
            {"icon": "book", "title": "Training of Trainers", "text": "We actively support the development of future language teachers, strengthening Malawi's educational capacity in German, French, and other foreign languages."},
            {"icon": "sprout", "title": "Youth Empowerment", "text": "We promote multilingualism among young Malawians, widening their worldview and introducing them to career and educational pathways made possible through language."},
            {"icon": "award", "title": "Certified Exam Centre", "text": "We are working toward becoming an accredited language examination centre in Malawi — so students can earn internationally recognised certificates without leaving the country."},
        ],
        "languages_title": "Languages we teach — and those coming next.",
        "languages_intro": "We currently offer German from beginner to upper-intermediate level, with an ambitious expansion plan in motion.",
        "languages": [
            {"code": "DE", "name": "German", "desc": "A1 · A2 · B1 · B2", "status": "Currently Offered"},
            {"code": "SW", "name": "Swahili", "desc": "East African regional language", "status": "Coming Soon"},
            {"code": "FR", "name": "French", "desc": "International & regional reach", "status": "Coming Soon"},
            {"code": "ES", "name": "Spanish", "desc": "Global language of opportunity", "status": "Coming Soon"},
            {"code": "ZH", "name": "Chinese", "desc": "Mandarin — global importance", "status": "Coming Soon"},
            {"code": "LA", "name": "Latin", "desc": "Classical & academic foundation", "status": "Coming Soon"},
        ],
        "vision_title": "A centre of excellence in language training for Malawi.",
        "vision_body": ("Heimatliebe Language Institute aspires to become the definitive hub for foreign language education in Malawi — "
                        "where academic rigour meets cultural curiosity, and every student leaves with skills that genuinely change "
                        "the direction of their life.\n\nWe believe that strong language education fosters cross-cultural connections, "
                        "improves employability, and prepares Malawians to engage confidently with the global community."),
        "vision_quote": "Strong language education fosters cross-cultural connections and prepares Malawians to engage confidently with the global community.",
        "contact_address": "Karonga, Northern Region, Malawi",
        "contact_phone": "+265 991 383 466",
        "contact_email": "heimatliebemw@gmail.com",
        "office_hours": "Mon–Fri: 8:00 AM – 5:00 PM\nSaturday: 9:00 AM – 1:00 PM",
        "social_facebook": "", "social_instagram": "", "social_tiktok": "", "social_youtube": "",
    },
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Settings (cached, invalidated on write) ──────────────────────────────
_settings_cache: dict[str, tuple[float, object]] = {}


async def get_setting(db: AsyncSession, key: str):
    hit = _settings_cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    row = await db.get(Setting, key)
    value = row.value if row else DEFAULT_SETTINGS.get(key)
    if isinstance(value, dict) and isinstance(DEFAULT_SETTINGS.get(key), dict):
        value = {**DEFAULT_SETTINGS[key], **value}
    _settings_cache[key] = (time.monotonic() + 60, value)
    return value


async def put_setting(db: AsyncSession, key: str, value) -> None:
    row = await db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))
    _settings_cache.pop(key, None)


# ── Public content cache (courses/news/gallery/... are read far more than written) ──
_public_cache: dict[str, tuple[float, object]] = {}
PUBLIC_TTL = 60.0


def public_cache_get(key: str):
    hit = _public_cache.get(key)
    return hit[1] if hit and hit[0] > time.monotonic() else None


def public_cache_put(key: str, value) -> None:
    _public_cache[key] = (time.monotonic() + PUBLIC_TTL, value)


def public_cache_clear(prefix: str = "") -> None:
    for k in [k for k in _public_cache if k.startswith(prefix)]:
        _public_cache.pop(k, None)


# ── Notifications (DB row + instant push) ────────────────────────────────
async def notify(db: AsyncSession, user_ids, title: str, body: str = "", link: str | None = None,
                 type_: str = "info", *, commit: bool = False) -> None:
    ids = [u for u in dict.fromkeys(user_ids) if u]
    if not ids:
        return
    rows = [{"id": uid(), "user_id": u, "title": title[:200], "body": body, "link": link, "type": type_,
             "read": False, "created_at": utcnow()} for u in ids]
    await db.execute(insert(Notification), rows)
    queue_event(db, "notification", {"title": title, "body": body, "link": link, "type": type_}, users=ids)
    if commit:
        await db.commit()


def queue_event(db: AsyncSession, event: str, data: dict | None = None, *, users=(), roles=()) -> None:
    """Deliver a realtime event once the current transaction commits (never for rolled-back work)."""
    db.info.setdefault("hmli_events", []).append(
        {"event": event, "data": data or {}, "users": list(users), "roles": list(roles)})


@sa_event.listens_for(Session, "after_commit")
def _publish_after_commit(session: Session) -> None:
    events = session.info.pop("hmli_events", None)
    if not events:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    for ev in events:
        if ev["users"] or ev["roles"]:
            loop.create_task(hub.publish(ev["event"], ev["data"], users=ev["users"], roles=ev["roles"]))
        if ev["event"] in webhooks.EVENTS:
            loop.create_task(webhooks.dispatch(ev["event"], ev["data"]))


async def class_student_ids(db: AsyncSession, class_id: str | None) -> list[str]:
    if not class_id:
        return []
    stmt = select(ClassEnrollment.user_id).where(ClassEnrollment.class_id == class_id,
                                                 ClassEnrollment.status == "active")
    return list((await db.execute(stmt)).scalars())


# ── Finance ──────────────────────────────────────────────────────────────
def money(v) -> float:
    if v is None:
        return 0.0
    return float(v) if not isinstance(v, Decimal) else float(v)


async def recompute_invoice(db: AsyncSession, invoice_id: str | None) -> None:
    """Invoice.paid = sum(confirmed payments); status follows from paid vs amount and due date."""
    if not invoice_id:
        return
    inv = await db.get(Invoice, invoice_id)
    if inv is None:
        return
    paid = (await db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.invoice_id == invoice_id, Payment.status == "confirmed")
    )).scalar_one()
    inv.paid = paid
    if inv.status != "cancelled":
        inv.status = invoice_status(money(inv.amount) - money(inv.discount), money(paid), inv.due_date)


def invoice_status(net_amount: float, paid: float, due: date | None) -> str:
    if paid >= net_amount - 0.005:
        return "paid"
    if due and due < date.today():
        return "overdue"
    return "partial" if paid > 0 else "pending"


# ── Human-readable sequential numbers (safe under concurrency via unique constraints) ──
async def _next_seq(db: AsyncSession, column, prefix: str, width: int) -> str:
    stmt = select(column).where(column.like(f"{prefix}%")).order_by(column.desc()).limit(1)
    last = (await db.execute(stmt)).scalar_one_or_none()
    n = 1
    if last:
        tail = last[len(prefix):]
        if tail.isdigit():
            n = int(tail) + 1
    return f"{prefix}{n:0{width}d}"


async def next_student_id(db: AsyncSession) -> str:
    return await _next_seq(db, User.user_id, f"HMLI-{date.today().year}-", 4)


async def next_staff_id(db: AsyncSession) -> str:
    return await _next_seq(db, User.user_id, "HMLI-STF-", 4)


async def next_invoice_number(db: AsyncSession) -> str:
    return await _next_seq(db, Invoice.invoice_number, f"INV-{date.today().year}-", 5)


async def next_receipt_no(db: AsyncSession) -> str:
    return await _next_seq(db, Payment.receipt_no, f"RCT-{date.today().year}-", 5)


async def next_certificate_no(db: AsyncSession) -> str:
    return await _next_seq(db, Certificate.certificate_no, f"HMLI-CERT-{date.today().year}-", 4)


def verification_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


def application_reference() -> str:
    return "APP-" + "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))


async def insert_with_retry(db: AsyncSession, make_obj, attempts: int = 5):
    """Insert an object whose number is derived from existing rows; retry if two requests raced."""
    for i in range(attempts):
        obj = await make_obj()
        try:
            async with db.begin_nested():  # savepoint: a collision only undoes this insert
                db.add(obj)
            return obj
        except IntegrityError:
            if i == attempts - 1:
                raise
    return None


async def confirm_payment(db: AsyncSession, payment: Payment, by: User) -> None:
    if not payment.invoice_id:
        # Unlinked payments settle the student's oldest open invoice automatically.
        payment.invoice_id = (await db.execute(
            select(Invoice.id).where(Invoice.user_id == payment.user_id,
                                     Invoice.status.in_(("pending", "partial", "overdue")))
            .order_by(Invoice.due_date.is_(None), Invoice.due_date, Invoice.created_at).limit(1))).scalar_one_or_none()
    payment.status = "confirmed"
    payment.processed_by = by.id
    payment.confirmed_at = utcnow()
    if not payment.receipt_no:
        payment.receipt_no = await next_receipt_no(db)
    await db.flush()
    await recompute_invoice(db, payment.invoice_id)


async def mark_overdue_invoices(db: AsyncSession) -> int:
    res = await db.execute(
        update(Invoice).where(Invoice.status.in_(("pending", "partial")), Invoice.due_date < date.today())
        .values(status="overdue")
    )
    return res.rowcount or 0
