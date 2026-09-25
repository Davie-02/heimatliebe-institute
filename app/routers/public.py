"""Public (unauthenticated) endpoints: site config, admissions, enquiries, placement tests,
external exam registration, application tracking and certificate verification."""
from __future__ import annotations

import html
import re
from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import mailer, placement_bank, services
from ..config import settings
from ..db import get_db
from ..models import (
    Application, Certificate, Enquiry, ExamRegistration, ExamSession, PlacementAttempt, User,
)
from ..responses import JSONResponse
from ..security import hash_password, optional_user, rate_limit, validate_new_password

router = APIRouter(tags=["public"])
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email(v: str) -> str:
    v = (v or "").strip().lower()
    if not EMAIL_RE.match(v):
        raise ValueError("Please enter a valid email address.")
    return v


@router.get("/config.json")
async def site_config(db: AsyncSession = Depends(get_db)):
    """Public, non-secret settings used by every page (institution details, homepage text, feature flags)."""
    return JSONResponse({"institution": await services.get_setting(db, "institution"),
                         "site": await services.get_setting(db, "site"),
                         "whatsapp": settings.whatsapp_number, "google_login": settings.google_enabled,
                         "placement_languages": placement_bank.available_languages()},
                        headers={"Cache-Control": "public, max-age=60"})


# ── Enquiries (contact form → CRM) ───────────────────────────────────────
class EnquiryIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str | None = Field(None, max_length=254)
    phone: str | None = Field(None, max_length=40)
    interest: str | None = Field(None, max_length=160)
    message: str | None = Field(None, max_length=4000)
    channel: str | None = Field("website", max_length=30)


@router.post("/api/contact-enquiry", dependencies=[Depends(rate_limit("enquiry", 30, 600))])
async def contact_enquiry(body: EnquiryIn, db: AsyncSession = Depends(get_db)):
    if not (body.email or body.phone):
        raise HTTPException(400, "Please give an email address or phone number so we can reply.")
    enq = Enquiry(name=body.name.strip(), email=(body.email or "").strip().lower() or None, phone=body.phone,
                  interest=body.interest, message=body.message, channel="website")
    db.add(enq)
    services.queue_event(db, "enquiry.new", {"name": enq.name, "interest": enq.interest},
                         roles=("admin", "director"))
    await db.commit()
    return {"ok": True, "message": "Thank you! We will be in touch shortly."}


# ── Admissions ───────────────────────────────────────────────────────────
class ApplicationIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: str
    phone: str = Field(min_length=5, max_length=40)
    course: str = Field(min_length=1, max_length=120)
    level: str = Field(min_length=1, max_length=40)
    password: str
    payment_proof_url: str | None = Field(None, max_length=1000)
    date_of_birth: date | None = None
    gender: str | None = Field(None, max_length=20)
    nationality: str | None = Field(None, max_length=80)
    address: str | None = Field(None, max_length=500)
    guardian_name: str | None = Field(None, max_length=200)
    guardian_phone: str | None = Field(None, max_length=40)
    preferred_schedule: str | None = Field(None, max_length=80)
    motivation: str | None = Field(None, max_length=4000)
    source: str | None = Field(None, max_length=80)
    placement_attempt_id: str | None = Field(None, max_length=36)

    @field_validator("email")
    @classmethod
    def _v_email(cls, v: str) -> str:
        return _email(v)


@router.post("/api/submit-application", status_code=201,
             dependencies=[Depends(rate_limit("apply", 30, 900))])
async def submit_application(body: ApplicationIn, request: Request, background: BackgroundTasks,
                             db: AsyncSession = Depends(get_db)):
    validate_new_password(body.password)
    inst = await services.get_setting(db, "institution")
    if not inst.get("enrolment_open", True):
        raise HTTPException(403, "Applications are currently closed. Please contact us for the next intake.")
    if body.payment_proof_url and not body.payment_proof_url.startswith(("/api/files/payment-proofs/", "http")):
        raise HTTPException(400, "Invalid payment proof reference.")
    # One open application per email keeps the admissions queue clean.
    dup = await db.execute(select(Application.reference).where(
        Application.email == body.email, Application.status.in_(("pending", "under_review", "interview", "waitlisted"))))
    if (ref := dup.scalar_one_or_none()):
        raise HTTPException(409, f"You already have an application in progress (reference {ref}). "
                                 "Use 'Track application' to check its status.")
    data = body.model_dump(exclude={"password"})
    pw_hash = await hash_password(body.password)

    async def make():
        return Application(**data, password_hash=pw_hash, reference=services.application_reference())

    app_row = await services.insert_with_retry(db, make)
    services.queue_event(db, "application.new", {"name": app_row.full_name, "course": app_row.course,
                                                 "reference": app_row.reference}, roles=("admin", "director"))
    await db.commit()
    site = settings.site_url or str(request.base_url).rstrip("/")
    msg = (f"<p>Thank you for applying for <strong>{html.escape(body.course)} ({html.escape(body.level)})</strong>."
           f" Our admissions team will review your application and payment proof shortly.</p>"
           f"{mailer.id_box('Application reference', app_row.reference)}"
           f"<p>You can track your application at any time:</p>"
           f"{mailer.button(f'{site}/status.html?ref={app_row.reference}', 'Track my application')}")
    background.add_task(mailer.send_email, body.email, "Application received — Heimatliebe Institute",
                        mailer.layout("Admissions", f"Hello {body.full_name},", msg))
    return {"ok": True, "reference": app_row.reference, "id": app_row.id}


class StatusIn(BaseModel):
    reference: str = Field(max_length=20)
    email: str = Field(max_length=254)


STATUS_TEXT = {
    "pending": "Received — waiting for review.",
    "under_review": "Under review by our admissions team.",
    "interview": "Shortlisted — we will contact you to arrange a short interview / oral assessment.",
    "waitlisted": "Waitlisted — the class is currently full. We will contact you when a place opens.",
    "approved": "Approved! Your student account is active.",
    "rejected": "Unfortunately your application was not successful this time.",
}


@router.post("/api/application-status", dependencies=[Depends(rate_limit("status", 20, 600))])
async def application_status(body: StatusIn, db: AsyncSession = Depends(get_db)):
    stmt = select(Application).where(Application.reference == body.reference.strip().upper(),
                                     Application.email == body.email.strip().lower())
    a = (await db.execute(stmt)).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "No application matches that reference and email.")
    return {"reference": a.reference, "full_name": a.full_name, "course": a.course, "level": a.level,
            "status": a.status, "status_text": STATUS_TEXT.get(a.status, a.status),
            "student_id": a.student_id if a.status == "approved" else None,
            "submitted_at": a.submitted_at, "reviewed_at": a.reviewed_at}


# ── Placement tests ──────────────────────────────────────────────────────
@router.get("/api/placement")
async def placement_languages():
    return {"languages": placement_bank.available_languages()}


@router.get("/api/placement/{language}")
async def placement_questions(language: str):
    qs = placement_bank.public_questions(language)
    if not qs:
        raise HTTPException(404, "No online placement test for this language yet — please contact us.")
    return JSONResponse({"language": language, "questions": qs}, headers={"Cache-Control": "public, max-age=3600"})


class PlacementIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: str | None = Field(None, max_length=254)
    phone: str | None = Field(None, max_length=40)
    answers: dict[str, int]


@router.post("/api/placement/{language}", dependencies=[Depends(rate_limit("placement", 60, 900))])
async def placement_submit(language: str, body: PlacementIn, background: BackgroundTasks,
                           user: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)):
    if language not in placement_bank.BANKS:
        raise HTTPException(404, "Unknown placement test.")
    result = placement_bank.score(language, body.answers)
    attempt = PlacementAttempt(full_name=body.full_name, email=(body.email or "").lower() or None, phone=body.phone,
                               language=language, answers=body.answers, score=result["score"],
                               total=result["total"], recommended_level=result["recommended_level"],
                               user_id=user.id if user else None)
    db.add(attempt)
    services.queue_event(db, "placement.new", {"name": body.full_name, "language": language,
                                               "level": result["recommended_level"]}, roles=("admin",))
    await db.commit()
    if attempt.email:
        msg = (f"<p>You scored <strong>{result['score']}/{result['total']}</strong> on our {html.escape(language)}"
               f" placement test.</p>{mailer.id_box('Recommended starting level', result['recommended_level'])}"
               "<p>Our teachers may confirm your level with a short oral check on your first day.</p>")
        background.add_task(mailer.send_email, attempt.email, "Your placement test result",
                            mailer.layout("Placement Test", f"Hello {body.full_name},", msg))
    return {"id": attempt.id, **result}


# ── External exams (Goethe, ÖSD, telc, DELF …) ───────────────────────────
class ExamRegistrationIn(BaseModel):
    session_id: str = Field(max_length=36)
    full_name: str = Field(min_length=2, max_length=200)
    email: str
    phone: str | None = Field(None, max_length=40)
    date_of_birth: date | None = None
    passport_no: str | None = Field(None, max_length=40)
    modules: str | None = Field(None, max_length=200)
    payment_proof_url: str | None = Field(None, max_length=1000)

    @field_validator("email")
    @classmethod
    def _v_email(cls, v: str) -> str:
        return _email(v)


@router.post("/api/exam-registrations/register", status_code=201,
             dependencies=[Depends(rate_limit("exam-reg", 30, 900))])
async def register_for_exam(body: ExamRegistrationIn, background: BackgroundTasks,
                            user: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)):
    sess = await db.get(ExamSession, body.session_id)
    if not sess or not sess.published:
        raise HTTPException(404, "Exam session not found.")
    if sess.registration_deadline and sess.registration_deadline < date.today():
        raise HTTPException(400, "Registration for this exam session has closed.")
    if sess.capacity:
        taken = (await db.execute(select(func.count()).select_from(ExamRegistration).where(
            ExamRegistration.session_id == sess.id, ExamRegistration.status != "cancelled"))).scalar_one()
        if taken >= sess.capacity:
            raise HTTPException(409, "This exam session is fully booked.")
    reg = ExamRegistration(**body.model_dump(), user_id=user.id if user else None)
    db.add(reg)
    services.queue_event(db, "exam_registration.new", {"name": reg.full_name, "exam": sess.title},
                         roles=("admin", "accounts"))
    await db.commit()
    msg = (f"<p>We have received your registration for <strong>{html.escape(sess.title)}</strong> on "
           f"{sess.exam_date:%d %B %Y}.</p><p>Your place is confirmed once payment has been verified.</p>")
    background.add_task(mailer.send_email, body.email, f"Exam registration — {sess.title}",
                        mailer.layout("Exam Registration", f"Hello {body.full_name},", msg))
    return {"ok": True, "id": reg.id}


# ── Certificate verification (for employers, embassies, universities) ────
@router.get("/api/verify-certificate/{code}", dependencies=[Depends(rate_limit("verify", 30, 60))])
async def verify_certificate(code: str, db: AsyncSession = Depends(get_db)):
    code = code.strip().upper()
    stmt = select(Certificate, User.full_name).join(User, User.id == Certificate.user_id).where(
        (Certificate.verification_code == code) | (Certificate.certificate_no == code))
    row = (await db.execute(stmt)).first()
    if not row:
        return {"valid": False}
    cert, name = row
    return {"valid": not cert.revoked, "revoked": cert.revoked, "certificate_no": cert.certificate_no,
            "full_name": name, "course": cert.course, "level": cert.level, "grade": cert.grade,
            "hours": cert.hours, "issued_at": cert.issued_at}
