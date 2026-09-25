"""Administration: users, admissions workflow, statistics, CSV reports, settings and search."""
from __future__ import annotations

import csv
import html
import io
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, extract, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import mailer, services
from ..config import settings
from ..db import get_db
from ..models import (
    ROLES, Application, Attendance, Class, ClassEnrollment, Course, Enquiry, ExamRegistration, ExamResult, Fee,
    Invoice, LeaveRequest, Payment, PlacementAttempt, User,
)
from ..realtime import hub
from ..responses import JSONResponse
from ..security import (
    audit, forget_user, hash_password, require_roles, require_staff, temp_password,
    validate_new_password,
)
from .auth import public_user

router = APIRouter(tags=["admin"])


# ── Users ────────────────────────────────────────────────────────────────
class NewUserIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: str | None = Field(None, max_length=254)
    phone: str | None = Field(None, max_length=40)
    role: str = Field("student")
    password: str | None = None
    user_id: str | None = Field(None, max_length=40)
    department: str | None = Field(None, max_length=120)
    course: str | None = Field(None, max_length=120)
    level: str | None = Field(None, max_length=40)
    send_welcome: bool = True


@router.post("/api/users", status_code=201)
async def create_user(body: NewUserIn, request: Request, background: BackgroundTasks,
                      user: User = Depends(require_roles("hr", "admin")), db: AsyncSession = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(400, "Unknown role.")
    if body.role in ("admin", "superadmin") and user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "Only administrators can create administrator accounts.")
    if body.role == "superadmin" and user.role != "superadmin":
        raise HTTPException(403, "Only a superadmin can create another superadmin.")
    email = (body.email or "").strip().lower() or None
    if email and (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(409, "A user with this email already exists.")
    password = body.password or temp_password()
    validate_new_password(password)
    pw_hash = await hash_password(password)

    async def make():
        if body.user_id:
            uid_ = body.user_id.strip().upper()
        else:
            uid_ = await (services.next_student_id(db) if body.role == "student" else services.next_staff_id(db))
        return User(user_id=uid_, full_name=body.full_name.strip(), email=email, phone=body.phone, role=body.role,
                    password_hash=pw_hash, department=body.department, course=body.course, level=body.level,
                    staff_id=uid_ if body.role != "student" else None, status="active",
                    must_change_password=body.password is None)

    try:
        new = await services.insert_with_retry(db, make, attempts=1 if body.user_id else 5)
    except Exception:
        await db.rollback()
        raise HTTPException(409, "That user ID is already taken.")
    await audit(db, request, user, "user.create", "users", new.id, {"role": body.role})
    await db.commit()
    if body.send_welcome and email:
        site = settings.site_url or str(request.base_url).rstrip("/")
        msg = (f"<p>An account has been created for you at Heimatliebe Institute.</p>"
               f"{mailer.id_box('Your login ID', new.user_id)}"
               f"<p>Temporary password: <strong>{html.escape(password)}</strong><br>Please change it after your first login.</p>"
               f"{mailer.button(f'{site}/login.html?id={new.user_id}', 'Log in')}")
        background.add_task(mailer.send_email, email, "Your Heimatliebe account",
                            mailer.layout("Welcome", f"Welcome, {new.full_name}!", msg))
    return {"ok": True, "user": public_user(new), "temporary_password": None if body.password else password}


@router.post("/api/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, request: Request, user: User = Depends(require_roles("hr", "admin")),
                               db: AsyncSession = Depends(get_db)):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found.")
    if target.role in ("admin", "superadmin") and user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "Only administrators can reset administrator passwords.")
    password = temp_password()
    target.password_hash = await hash_password(password)
    target.must_change_password = True
    await audit(db, request, user, "user.reset_password", "users", target.id)
    await db.commit()
    forget_user(target.id)
    return {"ok": True, "new_password": password}


# ── Admissions workflow ──────────────────────────────────────────────────
class ApproveIn(BaseModel):
    class_id: str | None = None
    fee_id: str | None = None
    invoice_amount: float | None = Field(None, gt=0)
    invoice_due: date | None = None
    record_application_payment: float | None = Field(None, gt=0, description="amount already paid with the proof")


async def _application(db, app_id) -> Application:
    a = await db.get(Application, app_id)
    if not a:
        raise HTTPException(404, "Application not found.")
    return a


@router.post("/api/applications/{app_id}/approve")
async def approve_application(app_id: str, body: ApproveIn, request: Request, background: BackgroundTasks,
                              user: User = Depends(require_roles("admin")), db: AsyncSession = Depends(get_db)):
    a = await _application(db, app_id)
    if a.status == "approved":
        raise HTTPException(409, f"Already approved (student ID {a.student_id}).")
    existing = (await db.execute(select(User).where(User.email == a.email.lower(), User.role == "student"))).scalar_one_or_none()
    if existing:
        student = existing
        student.course, student.level, student.status = a.course, a.level, "active"
    else:
        async def make():
            return User(user_id=await services.next_student_id(db), full_name=a.full_name, email=a.email.lower(),
                        phone=a.phone, role="student", status="active", password_hash=a.password_hash,
                        course=a.course, level=a.level, date_of_birth=a.date_of_birth, gender=a.gender,
                        nationality=a.nationality, address=a.address, guardian_name=a.guardian_name,
                        guardian_phone=a.guardian_phone)
        student = await services.insert_with_retry(db, make)
    a.status, a.student_id, a.reviewed_at, a.reviewed_by = "approved", student.user_id, services.utcnow(), user.id
    enrolled_in = None
    if body.class_id:
        cls = await db.get(Class, body.class_id)
        if not cls:
            raise HTTPException(404, "Class not found.")
        active = (await db.execute(select(func.count()).select_from(ClassEnrollment).where(
            ClassEnrollment.class_id == cls.id, ClassEnrollment.status == "active"))).scalar_one()
        status = "waitlisted" if cls.max_students and active >= cls.max_students else "active"
        already = (await db.execute(select(ClassEnrollment.id).where(ClassEnrollment.class_id == cls.id,
                                                                     ClassEnrollment.user_id == student.id))).first()
        if not already:
            db.add(ClassEnrollment(class_id=cls.id, user_id=student.id, status=status))
        enrolled_in = {"class": cls.name, "status": status}
    amount = body.invoice_amount
    if body.fee_id and not amount:
        fee = await db.get(Fee, body.fee_id)
        amount = services.money(fee.amount) if fee else None
    if amount:
        inv = Invoice(user_id=student.id, fee_id=body.fee_id, description=f"{a.course} {a.level} tuition",
                      amount=amount, due_date=body.invoice_due, created_by=user.id,
                      invoice_number=await services.next_invoice_number(db),
                      status=services.invoice_status(amount, 0, body.invoice_due))
        db.add(inv)
        await db.flush()
        if body.record_application_payment:
            p = Payment(user_id=student.id, invoice_id=inv.id, amount=body.record_application_payment,
                        method="bank", description="Paid with application", proof_url=a.payment_proof_url,
                        status="pending")
            db.add(p)
            await db.flush()
            await services.confirm_payment(db, p, user)
    await services.notify(db, [student.id], "Welcome to Heimatliebe Institute",
                          f"Your enrolment in {a.course} ({a.level}) is confirmed.", "/student/", "academic")
    services.queue_event(db, "application.approved", {"reference": a.reference, "student_id": student.user_id,
                                                      "full_name": a.full_name, "course": a.course, "level": a.level})
    await audit(db, request, user, "application.approve", "applications", a.id, {"student_id": student.user_id})
    await db.commit()
    site = settings.site_url or str(request.base_url).rstrip("/")
    msg = (f"<p>Your enrolment in <strong>{html.escape(a.course)} ({html.escape(a.level)})</strong> is now active.</p>"
           f"{mailer.id_box('Your Student ID', student.user_id)}"
           f"<p>Log in with your Student ID and the password you chose when applying.</p>"
           f"{mailer.button(f'{site}/login.html?id={student.user_id}', 'Go to the student portal')}")
    background.add_task(mailer.send_email, a.email, "Your Student ID — Heimatliebe Institute",
                        mailer.layout("Enrolment Confirmed", f"Welcome, {a.full_name}!", msg))
    return {"ok": True, "student_id": student.user_id, "user_id": student.id, "enrolment": enrolled_in}


class ApplicationStatusIn(BaseModel):
    status: str = Field(pattern="^(pending|under_review|interview|waitlisted|rejected)$")
    notes: str | None = Field(None, max_length=4000)
    notify_applicant: bool = True


@router.post("/api/applications/{app_id}/status")
async def application_status(app_id: str, body: ApplicationStatusIn, request: Request, background: BackgroundTasks,
                             user: User = Depends(require_roles("admin")), db: AsyncSession = Depends(get_db)):
    a = await _application(db, app_id)
    if a.status == "approved":
        raise HTTPException(409, "Approved applications cannot be changed here.")
    a.status, a.reviewed_at, a.reviewed_by = body.status, services.utcnow(), user.id
    if body.notes is not None:
        a.notes = body.notes
    await audit(db, request, user, f"application.{body.status}", "applications", a.id)
    await db.commit()
    from .public import STATUS_TEXT
    if body.notify_applicant:
        site = settings.site_url or str(request.base_url).rstrip("/")
        msg = (f"<p>Your application <strong>{html.escape(a.reference)}</strong> for {html.escape(a.course)} has been updated:</p>"
               f"<p style='font-size:17px;color:#1B4332'><strong>{html.escape(STATUS_TEXT[body.status])}</strong></p>"
               f"{mailer.button(f'{site}/status.html?ref={a.reference}', 'View application')}")
        background.add_task(mailer.send_email, a.email, "Application update — Heimatliebe Institute",
                            mailer.layout("Admissions", f"Hello {a.full_name},", msg))
    return {"ok": True}


# ── Statistics ───────────────────────────────────────────────────────────
@router.get("/api/stats/overview")
async def stats_overview(user: User = Depends(require_roles("admin", "director", "hr", "accounts")),
                         db: AsyncSession = Depends(get_db)):
    async def scalar(stmt):
        return (await db.execute(stmt)).scalar_one()

    count = lambda model, *where: scalar(select(func.count()).select_from(model).where(*where))
    by_role = dict((await db.execute(select(User.role, func.count()).where(User.status == "active")
                                     .group_by(User.role))).all())
    apps = dict((await db.execute(select(Application.status, func.count()).group_by(Application.status))).all())
    enq = dict((await db.execute(select(Enquiry.status, func.count()).group_by(Enquiry.status))).all())
    since30 = date.today() - timedelta(days=30)
    att = (await db.execute(select(func.count(), func.sum(case((Attendance.status.in_(("present", "late")), 1), else_=0)))
                            .where(Attendance.date >= since30))).one()
    yr, mo = extract("year", User.created_at), extract("month", User.created_at)
    growth = [{"month": f"{int(y)}-{int(m):02d}", "count": c} for y, m, c in (await db.execute(
        select(yr, mo, func.count()).where(User.role == "student", User.created_at >= date.today() - timedelta(days=365))
        .group_by(yr, mo).order_by(yr, mo))).all()]
    by_course = [{"course": c or "—", "count": n} for c, n in (await db.execute(
        select(User.course, func.count()).where(User.role == "student", User.status == "active")
        .group_by(User.course).order_by(func.count().desc()))).all()]
    by_level = [{"level": l or "—", "count": n} for l, n in (await db.execute(
        select(User.level, func.count()).where(User.role == "student", User.status == "active")
        .group_by(User.level).order_by(User.level))).all()]
    present = func.sum(case((Attendance.status.in_(("present", "late")), 1), else_=0))
    at_risk = [dict(r) for r in (await db.execute(
        select(User.id, User.user_id, User.full_name, func.count().label("sessions"),
               (present * 100.0 / func.count()).label("rate"))
        .join(Attendance, Attendance.user_id == User.id).where(Attendance.date >= date.today() - timedelta(days=60))
        .group_by(User.id, User.user_id, User.full_name)
        .having(and_(func.count() >= 4, present * 100.0 / func.count() < 75))
        .order_by(present * 100.0 / func.count()).limit(20))).mappings()]
    finance = {}
    if user.role in ("admin", "superadmin", "director", "accounts"):
        conf = Payment.status == "confirmed"
        finance = {
            "revenue_total": services.money(await scalar(select(func.coalesce(func.sum(Payment.amount), 0)).where(conf))),
            "revenue_month": services.money(await scalar(select(func.coalesce(func.sum(Payment.amount), 0)).where(
                conf, Payment.created_at >= date.today().replace(day=1)))),
            "outstanding": services.money(await scalar(select(func.coalesce(func.sum(Invoice.amount - Invoice.discount - Invoice.paid), 0))
                                                       .where(Invoice.status.in_(("pending", "partial", "overdue"))))),
            "pending_payments": await count(Payment, Payment.status == "pending"),
        }
    return JSONResponse({
        "users_by_role": by_role,
        "students": by_role.get("student", 0), "teachers": by_role.get("teacher", 0),
        "staff": sum(v for k, v in by_role.items() if k != "student"),
        "courses": await count(Course), "classes_active": await count(Class, Class.status == "active"),
        "applications": apps, "applications_open": sum(apps.get(s, 0) for s in ("pending", "under_review", "interview")),
        "enquiries": enq, "enquiries_open": sum(enq.get(s, 0) for s in ("new", "contacted", "follow_up")),
        "enquiry_conversion": round(enq.get("converted", 0) / sum(enq.values()) * 100, 1) if enq else None,
        "placement_tests_30d": await count(PlacementAttempt, PlacementAttempt.created_at >= since30),
        "exam_registrations_pending": await count(ExamRegistration, ExamRegistration.status == "pending"),
        "leave_pending": await count(LeaveRequest, LeaveRequest.status == "pending"),
        "attendance_rate_30d": round((att[1] or 0) / att[0] * 100, 1) if att[0] else None,
        "exam_average": (lambda v: round(v, 1) if v is not None else None)(
            await scalar(select(func.avg(ExamResult.percentage)))),
        "student_growth": growth, "students_by_course": by_course, "students_by_level": by_level,
        "at_risk": at_risk, "online_now": hub.online_users, **finance,
    })


# ── CSV reports (streamed; fine for tens of thousands of rows) ───────────
REPORTS = {
    "students": ("admin director hr accounts", lambda: select(
        User.user_id, User.full_name, User.email, User.phone, User.course, User.level, User.status, User.gender,
        User.nationality, User.guardian_name, User.guardian_phone, User.created_at).where(User.role == "student")
        .order_by(User.full_name)),
    "staff": ("admin director hr", lambda: select(
        User.user_id, User.full_name, User.role, User.department, User.email, User.phone, User.status, User.created_at)
        .where(User.role != "student").order_by(User.full_name)),
    "payments": ("admin director accounts", lambda: select(
        Payment.receipt_no, User.user_id, User.full_name, Payment.amount, Payment.method, Payment.reference,
        Payment.status, Payment.description, Payment.created_at, Payment.confirmed_at)
        .join(User, User.id == Payment.user_id).order_by(Payment.created_at.desc())),
    "invoices": ("admin director accounts", lambda: select(
        Invoice.invoice_number, User.user_id, User.full_name, Invoice.description, Invoice.amount, Invoice.discount,
        Invoice.paid, Invoice.status, Invoice.due_date, Invoice.created_at)
        .join(User, User.id == Invoice.user_id).order_by(Invoice.created_at.desc())),
    "results": ("admin director", lambda: select(
        User.user_id, User.full_name, ExamResult.title, ExamResult.score, ExamResult.total_points,
        ExamResult.percentage, ExamResult.passed, ExamResult.submitted_at)
        .join(User, User.id == ExamResult.user_id).order_by(ExamResult.submitted_at.desc())),
    "attendance": ("admin director hr", lambda: select(
        Attendance.date, Class.name.label("class"), User.user_id, User.full_name, Attendance.status, Attendance.notes)
        .join(User, User.id == Attendance.user_id).outerjoin(Class, Class.id == Attendance.class_id)
        .order_by(Attendance.date.desc())),
    "applications": ("admin director", lambda: select(
        Application.reference, Application.full_name, Application.email, Application.phone, Application.course,
        Application.level, Application.status, Application.source, Application.student_id, Application.submitted_at)
        .order_by(Application.submitted_at.desc())),
    "enquiries": ("admin director", lambda: select(
        Enquiry.name, Enquiry.email, Enquiry.phone, Enquiry.interest, Enquiry.channel, Enquiry.status,
        Enquiry.next_follow_up, Enquiry.message, Enquiry.created_at).order_by(Enquiry.created_at.desc())),
    "placements": ("admin director", lambda: select(
        PlacementAttempt.full_name, PlacementAttempt.email, PlacementAttempt.phone, PlacementAttempt.language,
        PlacementAttempt.score, PlacementAttempt.total, PlacementAttempt.recommended_level, PlacementAttempt.created_at)
        .order_by(PlacementAttempt.created_at.desc())),
}


@router.get("/api/reports/{kind}.csv")
async def report_csv(kind: str, request: Request, user: User = Depends(require_staff), db: AsyncSession = Depends(get_db)):
    spec = REPORTS.get(kind)
    if not spec:
        raise HTTPException(404, "Unknown report.")
    roles, build = spec
    if user.role not in roles.split() and user.role != "superadmin":
        raise HTTPException(403, "You do not have access to this report.")
    await audit(db, request, user, "report.export", kind)
    await db.commit()
    result = await db.stream(build())

    async def rows():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(list(result.keys()))
        yield "﻿" + buf.getvalue()  # BOM so Excel opens UTF-8 correctly
        async for part in result.partitions(500):
            buf.seek(0); buf.truncate()
            for r in part:
                w.writerow(["" if v is None else v for v in r])
            yield buf.getvalue()

    fname = f"{kind}-{date.today():%Y%m%d}.csv"
    return StreamingResponse(rows(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ── Settings (institution details, homepage content) ─────────────────────
@router.get("/api/settings/{key}")
async def get_settings(key: str, db: AsyncSession = Depends(get_db)):
    if key not in services.DEFAULT_SETTINGS:
        raise HTTPException(404, "Unknown settings group.")
    return JSONResponse(await services.get_setting(db, key))


@router.put("/api/settings/{key}")
async def put_settings(key: str, request: Request, user: User = Depends(require_roles("director", "admin")),
                       db: AsyncSession = Depends(get_db)):
    defaults = services.DEFAULT_SETTINGS.get(key)
    if defaults is None:
        raise HTTPException(404, "Unknown settings group.")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "Expected an object.")
    # Only known keys are stored, and each value must keep the type of its default (text, number, list …).
    clean = {}
    for k, v in body.items():
        if k in defaults and (defaults[k] is None or isinstance(v, type(defaults[k])) or
                              (isinstance(defaults[k], (int, float)) and isinstance(v, (int, float)))):
            clean[k] = v
    merged = {**await services.get_setting(db, key), **clean}
    await services.put_setting(db, key, merged)
    await audit(db, request, user, "settings.update", "settings", key, {"keys": sorted(clean)})
    await db.commit()
    services.public_cache_clear()
    return JSONResponse(merged)


# ── Global search (staff) ────────────────────────────────────────────────
@router.get("/api/search")
async def search(q: str, user: User = Depends(require_staff), db: AsyncSession = Depends(get_db)):
    q = q.strip()
    if len(q) < 2:
        return {"results": []}
    term = f"%{q}%"
    out = []
    user_stmt = select(User.id, User.user_id, User.full_name, User.role, User.course).where(
        or_(User.full_name.ilike(term), User.user_id.ilike(term), User.email.ilike(term), User.phone.ilike(term)))
    if user.role == "teacher":
        mine = select(ClassEnrollment.user_id).where(ClassEnrollment.class_id.in_(select(Class.id).where(Class.teacher_id == user.id)))
        user_stmt = user_stmt.where(or_(User.role != "student", User.id.in_(mine)))
    for r in (await db.execute(user_stmt.limit(15))).mappings():
        out.append({"type": "user", "id": r["id"], "title": r["full_name"],
                    "subtitle": f"{r['user_id']} · {r['role']}" + (f" · {r['course']}" if r["course"] else "")})
    if user.role in ("admin", "superadmin", "director", "hr", "accounts"):
        for r in (await db.execute(select(Application.id, Application.full_name, Application.reference, Application.status)
                                   .where(or_(Application.full_name.ilike(term), Application.email.ilike(term),
                                              Application.reference.ilike(term), Application.phone.ilike(term))).limit(10))).mappings():
            out.append({"type": "application", "id": r["id"], "title": r["full_name"],
                        "subtitle": f"{r['reference']} · {r['status']}"})
        for r in (await db.execute(select(Enquiry.id, Enquiry.name, Enquiry.interest, Enquiry.status)
                                   .where(or_(Enquiry.name.ilike(term), Enquiry.email.ilike(term), Enquiry.phone.ilike(term)))
                                   .limit(10))).mappings():
            out.append({"type": "enquiry", "id": r["id"], "title": r["name"],
                        "subtitle": f"{r['interest'] or 'Enquiry'} · {r['status']}"})
    for r in (await db.execute(select(Class.id, Class.name, Class.room).where(Class.name.ilike(term)).limit(10))).mappings():
        out.append({"type": "class", "id": r["id"], "title": r["name"], "subtitle": f"Room {r['room'] or '—'}"})
    for r in (await db.execute(select(Course.id, Course.title, Course.level).where(Course.title.ilike(term)).limit(10))).mappings():
        out.append({"type": "course", "id": r["id"], "title": r["title"], "subtitle": r["level"] or ""})
    return {"results": out}
