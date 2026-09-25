"""First-run bootstrap and data seeding.

    python -m app.seed create-admin ADMIN-001 'StrongPassword!' admin@example.com
    python -m app.seed demo          # realistic demo data for trying the portals locally
"""
from __future__ import annotations

import asyncio
import logging
import re
import sys
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import ROOT, settings
from .db import SessionLocal, init_db
from .models import (
    Announcement, Assignment, Class, ClassEnrollment, Course, Document, Enquiry, Event, Exam, ExamSession, Fee,
    GalleryItem, Invoice, LibraryItem, News, Testimonial, TimetableEntry, User,
)
from .security import hash_password, temp_password

log = logging.getLogger("hmli.seed")


# ── Markdown front matter (tiny parser for the starter content in content/) ──
def parse_front_matter(text: str) -> tuple[dict, str]:
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if not m:
        return {}, text
    fm: dict = {}
    current_list: list | None = None
    for line in m.group(1).splitlines():
        if not line.strip():
            continue
        item = re.match(r"^\s+-\s+(\w+):\s*(.*)$", line)
        if item and current_list is not None:
            current_list.append({item.group(1): item.group(2).strip()})
            continue
        kv = re.match(r"^(\w+):\s*(.*)$", line)
        if kv:
            key, val = kv.group(1), kv.group(2).strip()
            if val == "":
                current_list = fm[key] = []
            else:
                current_list = None
                fm[key] = {"true": True, "false": False}.get(val.lower(), val.strip('"'))
    return fm, m.group(2).strip()


def _date(v) -> date | None:
    try:
        return datetime.fromisoformat(str(v)).date() if v else None
    except ValueError:
        return None


async def import_markdown_content(db: AsyncSession) -> int:
    """Seed empty content tables from content/*.md so a new installation's website is never blank."""
    base = ROOT / "content"
    added = 0

    async def empty(model) -> bool:
        return (await db.execute(select(func.count()).select_from(model))).scalar_one() == 0

    def files(folder):
        d = base / folder
        return [parse_front_matter(p.read_text(encoding="utf-8")) for p in sorted(d.glob("*.md"))] if d.is_dir() else []

    if await empty(Course):
        for fm, body in files("courses"):
            db.add(Course(title=fm.get("title", "Course"), language=fm.get("language"), level=fm.get("level"),
                          status=fm.get("status"), schedule=fm.get("schedule"), duration=fm.get("duration"),
                          fee=fm.get("fee"), body=body, published=fm.get("published", True) is not False))
            added += 1
    if await empty(News):
        for fm, body in files("news"):
            db.add(News(title=fm.get("title", "News"), category=fm.get("category"), summary=fm.get("summary"),
                        body=body, image=fm.get("image"), date=_date(fm.get("date")),
                        published=fm.get("published", True) is not False))
            added += 1
    if await empty(GalleryItem):
        for fm, _ in files("gallery"):
            for photo in fm.get("photos") or []:
                db.add(GalleryItem(src=photo.get("image"), caption=fm.get("title"), category=fm.get("category")))
                added += 1
    if await empty(LibraryItem):
        for fm, body in files("library"):
            db.add(LibraryItem(title=fm.get("title", "Resource"), language=fm.get("language"), level=fm.get("level"),
                               type=fm.get("type"), file_url=fm.get("file"), cover_url=fm.get("cover"),
                               description=body or None, free=fm.get("free", True) is not False,
                               published=fm.get("published", True) is not False))
            added += 1
    if await empty(Testimonial):
        for fm, body in files("testimonials"):
            db.add(Testimonial(name=fm.get("name", "Student"), course=fm.get("course"), body=body or fm.get("body", ""),
                               photo=fm.get("photo")))
            added += 1
    if await empty(Document):
        for fm, body in files("documents"):
            if fm.get("file"):
                db.add(Document(title=fm.get("title", "Document"), description=fm.get("description") or body,
                                type=fm.get("type"), file=fm["file"], date=_date(fm.get("date"))))
                added += 1
    return added


async def ensure_admin(db: AsyncSession) -> None:
    """Guarantee there is at least one administrator (first deploy / migration from the old site)."""
    has_admin = (await db.execute(select(func.count()).select_from(User)
                                  .where(User.role.in_(("admin", "superadmin"))))).scalar_one()
    if has_admin:
        return
    password = settings.admin_password or temp_password()
    db.add(User(user_id=settings.admin_user_id.upper(), full_name="System Administrator",
                email=settings.admin_email.lower(), role="superadmin", status="active",
                password_hash=await hash_password(password), staff_id=settings.admin_user_id.upper(),
                must_change_password=not settings.admin_password))
    if settings.admin_password:
        log.warning("Created superadmin %s using ADMIN_PASSWORD.", settings.admin_user_id)
    else:
        log.warning("=" * 70)
        log.warning("Created superadmin %s with temporary password: %s", settings.admin_user_id, password)
        log.warning("Log in at /login.html and change it immediately.")
        log.warning("=" * 70)


async def bootstrap() -> None:
    async with SessionLocal() as db:
        await ensure_admin(db)
        n = await import_markdown_content(db)
        await db.commit()
        if n:
            log.info("Imported %d starter items from content/.", n)


# ── Demo data ────────────────────────────────────────────────────────────
async def seed_demo() -> None:
    await init_db()
    async with SessionLocal() as db:
        if (await db.execute(select(func.count()).select_from(User).where(User.role == "teacher"))).scalar_one():
            print("Demo data already present.")
            return
        pw = await hash_password("demo12345")
        mk = lambda uid_, name, role, **kw: User(user_id=uid_, full_name=name, role=role, password_hash=pw,
                                                 email=f"{uid_.lower()}@demo.heimatliebe.mw", status="active", **kw)
        staff = [mk("HMLI-STF-0001", "Anna Schneider", "teacher", department="German", staff_id="HMLI-STF-0001"),
                 mk("HMLI-STF-0002", "Pierre Dubois", "teacher", department="French", staff_id="HMLI-STF-0002"),
                 mk("HMLI-STF-0003", "Grace Phiri", "accounts", department="Accounts", staff_id="HMLI-STF-0003"),
                 mk("HMLI-STF-0004", "Joseph Banda", "hr", department="Human Resources", staff_id="HMLI-STF-0004"),
                 mk("HMLI-STF-0005", "Dr. Ruth Mwale", "director", department="Management", staff_id="HMLI-STF-0005")]
        db.add_all(staff)
        names = ["Chikondi Nyirenda", "Tawonga Mhango", "Kondwani Kaunda", "Thoko Mkandawire", "Mphatso Gondwe",
                 "Chisomo Msiska", "Limbani Chirwa", "Alinafe Mwakasungula", "Wezi Munthali", "Takondwa Zgambo"]
        students = [mk(f"HMLI-{date.today().year}-{i + 1:04d}", n, "student", course="German", level="A1" if i < 6 else "A2",
                       phone=f"+26599100{i:04d}") for i, n in enumerate(names)]
        db.add_all(students)
        a1 = Course(title="German A1 — Beginner", language="German", level="A1", status="Enrolling Now",
                    schedule="Mon & Wed, 17:00–19:00", duration="3 months", fee="MWK 200,000 / month",
                    fee_amount=200000, body="Start your German journey.")
        a2 = Course(title="German A2 — Elementary", language="German", level="A2", status="Starting Soon",
                    schedule="Tue & Thu, 17:00–19:00", duration="3 months", fee="MWK 220,000 / month", fee_amount=220000)
        fr = Course(title="French A1", language="French", level="A1", status="Coming Soon", fee="MWK 180,000 / month")
        db.add_all([a1, a2, fr])
        await db.flush()
        c1 = Class(name="German A1 — Section A", course_id=a1.id, teacher_id=staff[0].id, level="A1", room="R1",
                   schedule="Mon & Wed 17:00", start_date=date.today() - timedelta(days=30), max_students=8)
        c2 = Class(name="German A2 — Evening", course_id=a2.id, teacher_id=staff[0].id, level="A2", room="R2",
                   schedule="Tue & Thu 17:00", start_date=date.today() - timedelta(days=10), max_students=20)
        db.add_all([c1, c2])
        await db.flush()
        for i, s in enumerate(students):
            db.add(ClassEnrollment(class_id=c1.id if i < 6 else c2.id, user_id=s.id))
        for dow in (1, 3):
            db.add(TimetableEntry(class_id=c1.id, day_of_week=dow, start_time="17:00", end_time="19:00", room="R1"))
        for dow in (2, 4):
            db.add(TimetableEntry(class_id=c2.id, day_of_week=dow, start_time="17:00", end_time="19:00", room="R2"))
        now = datetime.now(timezone.utc)
        db.add(Assignment(title="Introduce yourself (Schreiben)", class_id=c1.id, skill="writing", total_points=20,
                          description="Write 80 words about yourself: name, origin, hobbies.", due_date=now + timedelta(days=3),
                          created_by=staff[0].id))
        db.add(Exam(title="A1 Unit 1–3 Quiz", class_id=c1.id, date=now - timedelta(hours=1), duration_minutes=20,
                    published=True, pass_mark=50, created_by=staff[0].id, questions=[
                        {"text": "Wie ___ du?", "type": "mcq", "options": ["heißt", "heiße", "heißen"], "answer": 0, "points": 1},
                        {"text": "Ich komme ___ Malawi.", "type": "mcq", "options": ["von", "aus", "nach"], "answer": 1, "points": 1},
                        {"text": "Translate: 'Good morning'", "type": "text", "answer": ["guten morgen"], "points": 2},
                    ]))
        fee = Fee(course_id=a1.id, amount=200000, frequency="monthly", type="tuition", description="A1 monthly tuition")
        db.add(fee)
        await db.flush()
        for i, s in enumerate(students[:6]):
            db.add(Invoice(user_id=s.id, fee_id=fee.id, description="September tuition", amount=200000,
                           invoice_number=f"INV-{date.today().year}-{i + 1:05d}", due_date=date.today() + timedelta(days=5),
                           status="pending"))
        db.add(Announcement(title="Welcome to the new term!", body="Classes start on Monday. Viel Erfolg!", audience="all",
                            pinned=True))
        db.add(Event(title="Goethe A1 mock exam", type="exam", start_date=date.today() + timedelta(days=14)))
        db.add(Event(title="Independence Day — no classes", type="holiday", start_date=date(date.today().year, 7, 6)))
        db.add(ExamSession(provider="Goethe-Institut", title="Goethe-Zertifikat A1: Start Deutsch 1", level="A1",
                           modules="Lesen, Hören, Schreiben, Sprechen", exam_date=date.today() + timedelta(days=60),
                           registration_deadline=date.today() + timedelta(days=30), venue="Dar es Salaam, Tanzania",
                           fee=250000, capacity=30))
        db.add(Enquiry(name="Mercy Kumwenda", phone="+265888000111", interest="German A1 evening", channel="whatsapp",
                       next_follow_up=date.today()))
        await db.commit()
    print("Demo data created. Every demo account's password is: demo12345")
    print("  teacher HMLI-STF-0001 · accounts HMLI-STF-0003 · hr HMLI-STF-0004 · director HMLI-STF-0005")
    print(f"  students HMLI-{date.today().year}-0001 … 0010")


async def create_admin(user_id: str, password: str, email: str) -> None:
    await init_db()
    async with SessionLocal() as db:
        existing = (await db.execute(select(User).where(User.user_id == user_id.upper()))).scalar_one_or_none()
        if existing:
            existing.password_hash = await hash_password(password)
            existing.role, existing.status = "superadmin", "active"
        else:
            db.add(User(user_id=user_id.upper(), full_name="Administrator", email=email.lower(), role="superadmin",
                        status="active", password_hash=await hash_password(password), staff_id=user_id.upper()))
        await db.commit()
    print(f"Superadmin {user_id.upper()} is ready.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "demo":
        asyncio.run(seed_demo())
    elif cmd == "create-admin" and len(sys.argv) >= 4:
        asyncio.run(create_admin(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "admin@heimatliebe.mw"))
    else:
        print(__doc__)
