"""Teaching & learning workflows: online exams with auto-grading, bulk attendance, rosters,
gradebooks, enrolment with waitlists, report cards, certificates and portal dashboards."""
from __future__ import annotations

import html
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import services
from ..db import get_db
from ..models import (
    Announcement, Assignment, Attendance, Certificate, Class, ClassEnrollment, Course, Event, Exam,
    ExamResult, Invoice, Message, ConversationParticipant, Notification, SkillAssessment, Submission,
    TimetableEntry, User,
)
from ..responses import JSONResponse
from ..security import audit, current_user, require_roles

router = APIRouter(tags=["academics"])
OFFICE_ROLES = {"admin", "superadmin", "director", "hr", "accounts"}


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _class_or_404(db: AsyncSession, class_id: str) -> Class:
    c = await db.get(Class, class_id)
    if not c:
        raise HTTPException(404, "Class not found.")
    return c


def _can_manage_class(user: User, cls: Class) -> bool:
    return user.role in ("admin", "superadmin", "director") or (user.role == "teacher" and cls.teacher_id == user.id)


async def can_view_student(db: AsyncSession, user: User, student_id: str) -> bool:
    if user.id == student_id or user.role in OFFICE_ROLES:
        return True
    if user.role == "teacher":
        stmt = select(func.count()).select_from(ClassEnrollment).join(Class, Class.id == ClassEnrollment.class_id) \
            .where(ClassEnrollment.user_id == student_id, Class.teacher_id == user.id)
        return (await db.execute(stmt)).scalar_one() > 0
    return False


# ── Online exams ─────────────────────────────────────────────────────────
class ExamSubmitIn(BaseModel):
    answers: dict[str, str | int | None]
    started_at: datetime | None = None


def grade_exam(questions: list[dict], answers: dict) -> tuple[float, float, bool]:
    """Returns (score, total_points, needs_manual_review)."""
    score = total = 0.0
    review = False
    for i, q in enumerate(questions or []):
        pts = float(q.get("points") or 1)
        total += pts
        given = answers.get(str(i), answers.get(i))
        key = q.get("answer")
        if q.get("type") == "mcq":
            try:
                if key is not None and given not in (None, "") and int(given) == int(key):
                    score += pts
            except (TypeError, ValueError):
                pass
        elif key not in (None, ""):
            accepted = [str(k).strip().lower() for k in (key if isinstance(key, list) else [key])]
            if str(given or "").strip().lower() in accepted:
                score += pts
        else:
            review = True  # open question without an answer key → teacher marks it
    return score, total, review


@router.post("/api/exams/{exam_id}/submit")
async def submit_exam(exam_id: str, body: ExamSubmitIn, request: Request,
                      user: User = Depends(require_roles("student")), db: AsyncSession = Depends(get_db)):
    exam = await db.get(Exam, exam_id)
    if not exam or not exam.published:
        raise HTTPException(404, "Exam not found.")
    now = datetime.now(timezone.utc)
    if exam.date and _aware(exam.date) > now:
        raise HTTPException(400, "This exam has not opened yet.")
    if exam.close_date and _aware(exam.close_date) + timedelta(minutes=2) < now:
        raise HTTPException(400, "This exam has closed.")
    if exam.class_id:
        enrolled = (await db.execute(select(func.count()).select_from(ClassEnrollment).where(
            ClassEnrollment.class_id == exam.class_id, ClassEnrollment.user_id == user.id))).scalar_one()
        if not enrolled:
            raise HTTPException(403, "You are not enrolled in this class.")
    exists = (await db.execute(select(ExamResult.id).where(ExamResult.exam_id == exam.id,
                                                           ExamResult.user_id == user.id))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "You have already submitted this exam.")
    score, total, review = grade_exam(exam.questions or [], body.answers)
    pct = round(score / total * 100, 1) if total else 0.0
    result = ExamResult(exam_id=exam.id, user_id=user.id, title=exam.title, answers=body.answers, score=score,
                        total_points=total, percentage=pct, passed=None if review else pct >= exam.pass_mark,
                        needs_review=review, started_at=body.started_at,
                        graded_at=None if review else now)
    db.add(result)
    cls = await db.get(Class, exam.class_id) if exam.class_id else None
    if cls and cls.teacher_id:
        await services.notify(db, [cls.teacher_id], "Exam submitted", f"{user.full_name} — {exam.title}",
                              "/teacher/?page=grading", "academic")
    await audit(db, request, user, "exam.submit", "exams", exam.id, {"score": score, "total": total})
    await db.commit()
    return {"ok": True, "score": score, "total_points": total, "percentage": pct, "needs_review": review,
            "passed": result.passed}


# ── Attendance ───────────────────────────────────────────────────────────
class AttendanceRecord(BaseModel):
    user_id: str
    status: str = Field(pattern="^(present|absent|late|excused)$")
    notes: str | None = Field(None, max_length=500)


class AttendanceBulkIn(BaseModel):
    class_id: str
    date: date
    records: list[AttendanceRecord] = Field(max_length=500)


@router.post("/api/attendance/bulk")
async def attendance_bulk(body: AttendanceBulkIn, request: Request,
                          user: User = Depends(require_roles("teacher", "admin", "director")),
                          db: AsyncSession = Depends(get_db)):
    cls = await _class_or_404(db, body.class_id)
    if not _can_manage_class(user, cls):
        raise HTTPException(403, "This is not your class.")
    enrolled = set((await db.execute(select(ClassEnrollment.user_id).where(
        ClassEnrollment.class_id == cls.id))).scalars())
    existing = {a.user_id: a for a in (await db.execute(select(Attendance).where(
        Attendance.class_id == cls.id, Attendance.date == body.date))).scalars()}
    absent = []
    for rec in body.records:
        if rec.user_id not in enrolled:
            continue
        row = existing.get(rec.user_id)
        if row:
            row.status, row.notes, row.marked_by = rec.status, rec.notes, user.id
        else:
            db.add(Attendance(class_id=cls.id, user_id=rec.user_id, date=body.date, status=rec.status,
                              notes=rec.notes, marked_by=user.id))
        if rec.status == "absent":
            absent.append(rec.user_id)
    if absent:
        await services.notify(db, absent, "Marked absent", f"{cls.name} on {body.date:%d %b %Y}",
                              "/student/?page=attendance", "attendance")
    await audit(db, request, user, "attendance.save", "classes", cls.id, {"date": str(body.date),
                                                                         "count": len(body.records)})
    await db.commit()
    return {"ok": True, "saved": len(body.records)}


async def attendance_rates(db: AsyncSession, user_ids: list[str] | None = None, class_id: str | None = None) -> dict[str, dict]:
    present = func.sum(case((Attendance.status.in_(("present", "late")), 1), else_=0))
    stmt = select(Attendance.user_id, func.count().label("total"), present.label("present")).group_by(Attendance.user_id)
    if user_ids is not None:
        stmt = stmt.where(Attendance.user_id.in_(user_ids))
    if class_id:
        stmt = stmt.where(Attendance.class_id == class_id)
    out = {}
    for uid_, total, pres in (await db.execute(stmt)).all():
        out[uid_] = {"sessions": total, "present": int(pres or 0),
                     "rate": round((pres or 0) / total * 100, 1) if total else None}
    return out


# ── Class roster, gradebook, enrolment ───────────────────────────────────
@router.get("/api/classes/{class_id}/roster")
async def class_roster(class_id: str, user: User = Depends(require_roles("teacher", "admin", "director", "hr", "accounts")),
                       db: AsyncSession = Depends(get_db)):
    cls = await _class_or_404(db, class_id)
    if user.role == "teacher" and cls.teacher_id != user.id:
        raise HTTPException(403, "This is not your class.")
    stmt = select(User.id, User.user_id, User.full_name, User.email, User.phone, User.level,
                  ClassEnrollment.status, ClassEnrollment.enrolled_at) \
        .join(ClassEnrollment, ClassEnrollment.user_id == User.id) \
        .where(ClassEnrollment.class_id == class_id).order_by(User.full_name)
    students = [dict(r) for r in (await db.execute(stmt)).mappings()]
    rates = await attendance_rates(db, [s["id"] for s in students], class_id)
    for s in students:
        s["attendance"] = rates.get(s["id"])
    return JSONResponse({"class": {"id": cls.id, "name": cls.name, "max_students": cls.max_students},
                         "students": students})


@router.get("/api/classes/{class_id}/gradebook")
async def gradebook(class_id: str, user: User = Depends(require_roles("teacher", "admin", "director")),
                    db: AsyncSession = Depends(get_db)):
    cls = await _class_or_404(db, class_id)
    if not _can_manage_class(user, cls):
        raise HTTPException(403, "This is not your class.")
    students = [dict(r) for r in (await db.execute(
        select(User.id, User.user_id, User.full_name).join(ClassEnrollment, ClassEnrollment.user_id == User.id)
        .where(ClassEnrollment.class_id == class_id, ClassEnrollment.status.in_(("active", "completed")))
        .order_by(User.full_name))).mappings()]
    assignments = [dict(r) for r in (await db.execute(
        select(Assignment.id, Assignment.title, Assignment.total_points, Assignment.due_date)
        .where(Assignment.class_id == class_id).order_by(Assignment.due_date))).mappings()]
    exams = [dict(r) for r in (await db.execute(
        select(Exam.id, Exam.title, Exam.date).where(Exam.class_id == class_id).order_by(Exam.date))).mappings()]
    subs = (await db.execute(select(Submission.user_id, Submission.assignment_id, Submission.grade)
                             .where(Submission.assignment_id.in_([a["id"] for a in assignments] or [""])))).all()
    results = (await db.execute(select(ExamResult.user_id, ExamResult.exam_id, ExamResult.percentage)
                                .where(ExamResult.exam_id.in_([e["id"] for e in exams] or [""])))).all()
    rates = await attendance_rates(db, [s["id"] for s in students], class_id)
    points = {a["id"]: a["total_points"] or 100 for a in assignments}
    grid: dict[str, dict] = {s["id"]: {"assignments": {}, "exams": {}} for s in students}
    for uid_, aid, grade in subs:
        if uid_ in grid:
            grid[uid_]["assignments"][aid] = grade
    for uid_, eid, pct in results:
        if uid_ in grid:
            grid[uid_]["exams"][eid] = pct
    for s in students:
        g = grid[s["id"]]
        pcts = [v / points[k] * 100 for k, v in g["assignments"].items() if v is not None and points.get(k)]
        pcts += [v for v in g["exams"].values() if v is not None]
        s.update(g, average=round(sum(pcts) / len(pcts), 1) if pcts else None, attendance=rates.get(s["id"]))
    return JSONResponse({"class": {"id": cls.id, "name": cls.name}, "assignments": assignments, "exams": exams,
                         "students": students})


class EnrollIn(BaseModel):
    user_ids: list[str] = Field(min_length=1, max_length=500)


@router.post("/api/classes/{class_id}/enroll")
async def enroll(class_id: str, body: EnrollIn, request: Request,
                 user: User = Depends(require_roles("admin", "director")), db: AsyncSession = Depends(get_db)):
    cls = await _class_or_404(db, class_id)
    current = set((await db.execute(select(ClassEnrollment.user_id).where(ClassEnrollment.class_id == class_id))).scalars())
    active = (await db.execute(select(func.count()).select_from(ClassEnrollment).where(
        ClassEnrollment.class_id == class_id, ClassEnrollment.status == "active"))).scalar_one()
    added, waitlisted = [], []
    for sid in dict.fromkeys(body.user_ids):
        if sid in current:
            continue
        full = cls.max_students and active >= cls.max_students
        db.add(ClassEnrollment(class_id=class_id, user_id=sid, status="waitlisted" if full else "active"))
        (waitlisted if full else added).append(sid)
        if not full:
            active += 1
    await services.notify(db, added, "Enrolled in class", cls.name, "/student/?page=timetable", "academic")
    await services.notify(db, waitlisted, "Added to waitlist", f"{cls.name} is full — you are on the waitlist.",
                          None, "academic")
    await audit(db, request, user, "class.enroll", "classes", class_id, {"added": len(added), "waitlisted": len(waitlisted)})
    await db.commit()
    return {"ok": True, "enrolled": len(added), "waitlisted": len(waitlisted)}


@router.post("/api/classes/{class_id}/unenroll/{student_id}")
async def unenroll(class_id: str, student_id: str, request: Request,
                   user: User = Depends(require_roles("admin", "director")), db: AsyncSession = Depends(get_db)):
    cls = await _class_or_404(db, class_id)
    row = (await db.execute(select(ClassEnrollment).where(ClassEnrollment.class_id == class_id,
                                                          ClassEnrollment.user_id == student_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Enrolment not found.")
    was_active = row.status == "active"
    await db.delete(row)
    promoted = None
    if was_active:  # first person on the waitlist gets the freed seat
        nxt = (await db.execute(select(ClassEnrollment).where(ClassEnrollment.class_id == class_id,
                                                              ClassEnrollment.status == "waitlisted")
                                .order_by(ClassEnrollment.enrolled_at).limit(1))).scalar_one_or_none()
        if nxt:
            nxt.status = "active"
            promoted = nxt.user_id
            await services.notify(db, [promoted], "A place opened up!", f"You are now enrolled in {cls.name}.",
                                  "/student/?page=timetable", "academic")
    await audit(db, request, user, "class.unenroll", "classes", class_id, {"student": student_id})
    await db.commit()
    return {"ok": True, "promoted_from_waitlist": promoted}


# ── Student report card ──────────────────────────────────────────────────
async def build_report(db: AsyncSession, student_id: str) -> dict:
    student = await db.get(User, student_id)
    if not student or student.role != "student":
        raise HTTPException(404, "Student not found.")
    classes = [dict(r) for r in (await db.execute(
        select(Class.id, Class.name, Class.level, User.full_name.label("teacher"), ClassEnrollment.status)
        .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
        .outerjoin(User, User.id == Class.teacher_id)
        .where(ClassEnrollment.user_id == student_id))).mappings()]
    subs = [dict(r) for r in (await db.execute(
        select(Assignment.title, Assignment.total_points, Assignment.skill, Submission.grade, Submission.feedback)
        .join(Submission, Submission.assignment_id == Assignment.id)
        .where(Submission.user_id == student_id).order_by(Submission.submitted_at))).mappings()]
    exams = [dict(r) for r in (await db.execute(
        select(ExamResult.title, ExamResult.score, ExamResult.total_points, ExamResult.percentage, ExamResult.passed,
               ExamResult.submitted_at).where(ExamResult.user_id == student_id)
        .order_by(ExamResult.submitted_at))).mappings()]
    skills = [dict(r) for r in (await db.execute(
        select(SkillAssessment.term, SkillAssessment.reading, SkillAssessment.writing, SkillAssessment.listening,
               SkillAssessment.speaking, SkillAssessment.cefr_level, SkillAssessment.comments, SkillAssessment.created_at)
        .where(SkillAssessment.user_id == student_id).order_by(SkillAssessment.created_at))).mappings()]
    att = (await attendance_rates(db, [student_id])).get(student_id)
    graded = [s["grade"] / (s["total_points"] or 100) * 100 for s in subs if s["grade"] is not None]
    exam_pcts = [e["percentage"] for e in exams if e["percentage"] is not None]
    return {
        "student": {"id": student.id, "user_id": student.user_id, "full_name": student.full_name,
                    "course": student.course, "level": student.level, "email": student.email},
        "classes": classes, "assignments": subs, "exams": exams, "skills": skills, "attendance": att,
        "summary": {
            "assignment_average": round(sum(graded) / len(graded), 1) if graded else None,
            "exam_average": round(sum(exam_pcts) / len(exam_pcts), 1) if exam_pcts else None,
            "attendance_rate": att["rate"] if att else None,
            "latest_cefr": skills[-1]["cefr_level"] if skills else student.level,
        },
    }


@router.get("/api/students/{student_id}/report")
async def student_report(student_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not await can_view_student(db, user, student_id):
        raise HTTPException(403, "Access denied.")
    return JSONResponse(await build_report(db, student_id))


def _esc(v) -> str:
    return html.escape("" if v is None else str(v))


PRINT_CSS = """<style>
body{font-family:Georgia,serif;color:#1A1A1A;max-width:820px;margin:24px auto;padding:0 24px}
h1{color:#1B4332;margin:0}h2{color:#1B4332;border-bottom:2px solid #C9A84C;padding-bottom:4px;margin-top:28px;font-size:1.1rem}
table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
th{background:#F7F5EF}.muted{color:#4A6572;font-family:Arial,sans-serif;font-size:13px}.head{display:flex;justify-content:space-between;align-items:end;border-bottom:4px solid #1B4332;padding-bottom:12px}
.btn{font-family:Arial;padding:8px 16px;background:#1B4332;color:#fff;border:0;cursor:pointer}@media print{.noprint{display:none}}
</style>"""


@router.get("/api/students/{student_id}/report.html", response_class=HTMLResponse)
async def student_report_html(student_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not await can_view_student(db, user, student_id):
        raise HTTPException(403, "Access denied.")
    r = await build_report(db, student_id)
    inst = await services.get_setting(db, "institution")
    s, sm = r["student"], r["summary"]
    rows = lambda items, cols: "".join("<tr>" + "".join(f"<td>{_esc(i.get(c))}</td>" for c in cols) + "</tr>" for i in items) or \
        f"<tr><td colspan='{len(cols)}' class='muted'>No records</td></tr>"
    body = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report — {_esc(s['full_name'])}</title>{PRINT_CSS}</head><body>
<p class="noprint"><button class="btn" data-print>Print / Save as PDF</button><script src="/js/print.js" defer></script></p>
<div class="head"><div><h1>{_esc(inst['name'])}</h1><div class="muted">{_esc(inst['location'])} · Academic Report · {_esc(inst['current_term'])} {_esc(inst['academic_year'])}</div></div>
<div class="muted">Generated {date.today():%d %b %Y}</div></div>
<h2>Student</h2><table><tr><th>Name</th><td>{_esc(s['full_name'])}</td><th>Student ID</th><td>{_esc(s['user_id'])}</td></tr>
<tr><th>Course</th><td>{_esc(s['course'])}</td><th>Current CEFR level</th><td>{_esc(sm['latest_cefr'])}</td></tr></table>
<h2>Summary</h2><table><tr><th>Assignment average</th><td>{_esc(sm['assignment_average'])}%</td><th>Exam average</th><td>{_esc(sm['exam_average'])}%</td><th>Attendance</th><td>{_esc(sm['attendance_rate'])}%</td></tr></table>
<h2>Classes</h2><table><tr><th>Class</th><th>Level</th><th>Teacher</th><th>Status</th></tr>{rows(r['classes'], ['name','level','teacher','status'])}</table>
<h2>Skills (CEFR)</h2><table><tr><th>Term</th><th>Reading</th><th>Writing</th><th>Listening</th><th>Speaking</th><th>Level</th><th>Comments</th></tr>{rows(r['skills'], ['term','reading','writing','listening','speaking','cefr_level','comments'])}</table>
<h2>Exams</h2><table><tr><th>Exam</th><th>Score</th><th>Out of</th><th>%</th><th>Passed</th></tr>{rows(r['exams'], ['title','score','total_points','percentage','passed'])}</table>
<h2>Assignments</h2><table><tr><th>Assignment</th><th>Skill</th><th>Grade</th><th>Out of</th><th>Feedback</th></tr>{rows(r['assignments'], ['title','skill','grade','total_points','feedback'])}</table>
<p class="muted" style="margin-top:40px">Director's signature: ____________________ &nbsp;&nbsp; Class teacher: ____________________</p>
</body></html>"""
    return HTMLResponse(body)


# ── Certificates ─────────────────────────────────────────────────────────
class CertificateIn(BaseModel):
    user_id: str
    class_id: str | None = None
    course: str = Field(min_length=1, max_length=200)
    level: str | None = Field(None, max_length=40)
    grade: str | None = Field(None, max_length=40)
    hours: int | None = Field(None, ge=0, le=5000)
    issued_at: date | None = None


@router.post("/api/certificates/issue", status_code=201)
async def issue_certificate(body: CertificateIn, request: Request,
                            user: User = Depends(require_roles("admin", "director")), db: AsyncSession = Depends(get_db)):
    student = await db.get(User, body.user_id)
    if not student or student.role != "student":
        raise HTTPException(404, "Student not found.")

    async def make():
        return Certificate(**body.model_dump(exclude_none=True), issued_by=user.id,
                           certificate_no=await services.next_certificate_no(db),
                           verification_code=services.verification_code())

    cert = await services.insert_with_retry(db, make)
    await services.notify(db, [student.id], "Certificate issued", f"{cert.course} {cert.level or ''}".strip(),
                          "/student/?page=certificates", "academic")
    services.queue_event(db, "certificate.issued", {"certificate_no": cert.certificate_no, "student_id": student.user_id,
                                                    "course": cert.course, "level": cert.level})
    await audit(db, request, user, "certificate.issue", "certificates", cert.id)
    await db.commit()
    return {"ok": True, "id": cert.id, "certificate_no": cert.certificate_no, "verification_code": cert.verification_code}


@router.get("/api/certificates/{cert_id}/print", response_class=HTMLResponse)
async def print_certificate(cert_id: str, request: Request, user: User = Depends(current_user),
                            db: AsyncSession = Depends(get_db)):
    cert = await db.get(Certificate, cert_id)
    if not cert or (cert.user_id != user.id and user.role not in OFFICE_ROLES):
        raise HTTPException(404, "Certificate not found.")
    student = await db.get(User, cert.user_id)
    inst = await services.get_setting(db, "institution")
    verify_url = f"{str(request.base_url).rstrip('/')}/verify.html?code={cert.verification_code}"
    return HTMLResponse(f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Certificate {_esc(cert.certificate_no)}</title>
<style>@page{{size:A4 landscape;margin:0}}body{{margin:0;font-family:Georgia,serif;background:#eee}}
.cert{{width:297mm;height:210mm;box-sizing:border-box;margin:0 auto;background:#fff;padding:18mm;position:relative}}
.frame{{border:3px solid #1B4332;outline:1px solid #C9A84C;outline-offset:-10px;height:100%;box-sizing:border-box;text-align:center;padding:14mm 20mm}}
h1{{font-size:44px;color:#1B4332;margin:6mm 0 2mm;letter-spacing:2px}}.gold{{color:#C9A84C;letter-spacing:6px;text-transform:uppercase;font-size:13px}}
.name{{font-size:38px;font-style:italic;border-bottom:1px solid #C9A84C;display:inline-block;padding:0 12mm 2mm;margin:6mm 0}}
.meta{{font-family:Arial;font-size:12px;color:#4A6572;position:absolute;bottom:26mm;left:30mm;right:30mm;display:flex;justify-content:space-between;text-align:left}}
.sig{{border-top:1px solid #1A1A1A;padding-top:4px;width:60mm;text-align:center}}.noprint{{text-align:center;padding:10px}}@media print{{.noprint{{display:none}}body{{background:#fff}}}}
{'.void{position:absolute;top:40%;left:0;right:0;font-size:90px;color:rgba(200,0,0,.25);transform:rotate(-15deg)}' if cert.revoked else ''}</style></head><body>
<div class="noprint"><button data-print>Print / Save as PDF</button><script src="/js/print.js" defer></script></div>
<div class="cert"><div class="frame">{'<div class="void">REVOKED</div>' if cert.revoked else ''}
<div class="gold">{_esc(inst['name'])} · {_esc(inst['location'])}</div>
<h1>Certificate of Achievement</h1><div style="font-size:16px">This is to certify that</div>
<div class="name">{_esc(student.full_name if student else '')}</div>
<div style="font-size:17px;line-height:1.6">has successfully completed <strong>{_esc(cert.course)}</strong>
{f' at CEFR level <strong>{_esc(cert.level)}</strong>' if cert.level else ''}{f' with grade <strong>{_esc(cert.grade)}</strong>' if cert.grade else ''}
{f'<br>({cert.hours} teaching hours)' if cert.hours else ''}</div>
<div class="meta"><div>Certificate No: <strong>{_esc(cert.certificate_no)}</strong><br>Issued: {cert.issued_at:%d %B %Y}<br>
Verify: {_esc(verify_url)}<br>Code: <strong>{_esc(cert.verification_code)}</strong></div>
<div class="sig">Director</div><div class="sig">Academic Coordinator</div></div></div></div></body></html>""")


# ── Portal dashboards (one round-trip each) ──────────────────────────────
@router.get("/api/dashboard/student")
async def student_dashboard(user: User = Depends(require_roles("student")), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    class_ids = list((await db.execute(select(ClassEnrollment.class_id).where(
        ClassEnrollment.user_id == user.id, ClassEnrollment.status == "active"))).scalars())
    in_my_classes = lambda col: (col.is_(None)) | (col.in_(class_ids or [""]))
    upcoming_assignments = [dict(r) for r in (await db.execute(
        select(Assignment.id, Assignment.title, Assignment.due_date, Assignment.class_id)
        .where(Assignment.published.is_(True), in_my_classes(Assignment.class_id), Assignment.due_date >= now,
               ~Assignment.id.in_(select(Submission.assignment_id).where(Submission.user_id == user.id)))
        .order_by(Assignment.due_date).limit(6))).mappings()]
    upcoming_exams = [dict(r) for r in (await db.execute(
        select(Exam.id, Exam.title, Exam.date, Exam.duration_minutes)
        .where(Exam.published.is_(True), in_my_classes(Exam.class_id), Exam.date >= now - timedelta(days=1))
        .order_by(Exam.date).limit(5))).mappings()]
    recent_results = [dict(r) for r in (await db.execute(
        select(ExamResult.title, ExamResult.percentage, ExamResult.passed, ExamResult.submitted_at)
        .where(ExamResult.user_id == user.id).order_by(ExamResult.submitted_at.desc()).limit(5))).mappings()]
    avg = (await db.execute(select(func.avg(ExamResult.percentage)).where(ExamResult.user_id == user.id))).scalar()
    balance = (await db.execute(select(func.coalesce(func.sum(Invoice.amount - Invoice.discount - Invoice.paid), 0))
                                .where(Invoice.user_id == user.id, Invoice.status != "cancelled"))).scalar_one()
    dow = (date.today().weekday() + 1) % 7  # Python Mon=0 → our Sun=0
    today_classes = [dict(r) for r in (await db.execute(
        select(TimetableEntry.start_time, TimetableEntry.end_time, TimetableEntry.room, Class.name, Class.meeting_url)
        .join(Class, Class.id == TimetableEntry.class_id)
        .where(TimetableEntry.class_id.in_(class_ids or [""]), TimetableEntry.day_of_week == dow)
        .order_by(TimetableEntry.start_time))).mappings()]
    announcements = [dict(r) for r in (await db.execute(
        select(Announcement.id, Announcement.title, Announcement.body, Announcement.created_at, Announcement.pinned)
        .where(Announcement.published.is_(True), Announcement.audience.in_(("all", "students", "student")),
               (Announcement.class_id.is_(None)) | (Announcement.class_id.in_(class_ids or [""])),
               (Announcement.expires_at.is_(None)) | (Announcement.expires_at >= date.today()))
        .order_by(Announcement.pinned.desc(), Announcement.created_at.desc()).limit(5))).mappings()]
    events = [dict(r) for r in (await db.execute(
        select(Event.title, Event.type, Event.start_date, Event.end_date)
        .where(Event.start_date >= date.today()).order_by(Event.start_date).limit(5))).mappings()]
    att = (await attendance_rates(db, [user.id])).get(user.id)
    return JSONResponse({
        "upcoming_assignments": upcoming_assignments, "upcoming_exams": upcoming_exams,
        "recent_results": recent_results, "average": round(avg, 1) if avg is not None else None,
        "balance": services.money(balance), "today_classes": today_classes, "announcements": announcements,
        "events": events, "attendance": att, "class_count": len(class_ids),
        "unread": await unread_counts(db, user),
    })


@router.get("/api/dashboard/teacher")
async def teacher_dashboard(user: User = Depends(require_roles("teacher", "admin")), db: AsyncSession = Depends(get_db)):
    class_rows = [dict(r) for r in (await db.execute(
        select(Class.id, Class.name, Class.room, Class.schedule, Class.level, Class.max_students,
               func.count(ClassEnrollment.id).label("students"))
        .outerjoin(ClassEnrollment, and_(ClassEnrollment.class_id == Class.id, ClassEnrollment.status == "active"))
        .where(Class.teacher_id == user.id, Class.status != "cancelled").group_by(Class.id))).mappings()]
    ids = [c["id"] for c in class_rows] or [""]
    pending = [dict(r) for r in (await db.execute(
        select(Submission.id, Submission.submitted_at, Assignment.title, User.full_name)
        .join(Assignment, Assignment.id == Submission.assignment_id).join(User, User.id == Submission.user_id)
        .where(Assignment.class_id.in_(ids), Submission.grade.is_(None))
        .order_by(Submission.submitted_at).limit(10))).mappings()]
    pending_count = (await db.execute(select(func.count()).select_from(Submission)
                                      .join(Assignment, Assignment.id == Submission.assignment_id)
                                      .where(Assignment.class_id.in_(ids), Submission.grade.is_(None)))).scalar_one()
    review_count = (await db.execute(select(func.count()).select_from(ExamResult).join(Exam, Exam.id == ExamResult.exam_id)
                                     .where(Exam.class_id.in_(ids), ExamResult.needs_review.is_(True)))).scalar_one()
    exams = [dict(r) for r in (await db.execute(
        select(Exam.id, Exam.title, Exam.date, Exam.published).where(Exam.class_id.in_(ids),
                                                                     Exam.date >= datetime.now(timezone.utc) - timedelta(days=1))
        .order_by(Exam.date).limit(5))).mappings()]
    dow = (date.today().weekday() + 1) % 7
    today = [dict(r) for r in (await db.execute(
        select(TimetableEntry.start_time, TimetableEntry.end_time, TimetableEntry.room, Class.name, Class.id.label("class_id"))
        .join(Class, Class.id == TimetableEntry.class_id)
        .where(TimetableEntry.class_id.in_(ids), TimetableEntry.day_of_week == dow)
        .order_by(TimetableEntry.start_time))).mappings()]
    return JSONResponse({"classes": class_rows, "pending_submissions": pending, "pending_count": pending_count,
                         "exams_to_review": review_count, "upcoming_exams": exams, "today": today,
                         "unread": await unread_counts(db, user)})


async def unread_counts(db: AsyncSession, user: User) -> dict:
    notes = (await db.execute(select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id, Notification.read.is_(False)))).scalar_one()
    msgs = (await db.execute(
        select(func.count()).select_from(Message)
        .join(ConversationParticipant, ConversationParticipant.conversation_id == Message.conversation_id)
        .where(ConversationParticipant.user_id == user.id, Message.sender_id != user.id,
               (ConversationParticipant.last_read_at.is_(None)) | (Message.created_at > ConversationParticipant.last_read_at))
    )).scalar_one()
    return {"notifications": notes, "messages": msgs}


@router.get("/api/unread")
async def unread(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return await unread_counts(db, user)


@router.get("/api/me/timetable")
async def my_timetable(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if user.role == "student":
        cls_filter = Class.id.in_(select(ClassEnrollment.class_id).where(ClassEnrollment.user_id == user.id,
                                                                         ClassEnrollment.status == "active"))
    elif user.role == "teacher":
        cls_filter = Class.teacher_id == user.id
    else:
        cls_filter = Class.status == "active"
    rows = (await db.execute(
        select(TimetableEntry.id, TimetableEntry.day_of_week, TimetableEntry.start_time, TimetableEntry.end_time,
               TimetableEntry.room, Class.id.label("class_id"), Class.name.label("class_name"), Class.meeting_url,
               Class.mode, User.full_name.label("teacher"))
        .join(Class, Class.id == TimetableEntry.class_id).outerjoin(User, User.id == Class.teacher_id)
        .where(cls_filter).order_by(TimetableEntry.day_of_week, TimetableEntry.start_time))).mappings()
    return JSONResponse([dict(r) for r in rows])


@router.get("/api/me/courses-summary")
async def my_courses(user: User = Depends(require_roles("student")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Class.id, Class.name, Class.level, Class.room, Class.schedule, Class.meeting_url, Class.mode,
               Course.title.label("course"), User.full_name.label("teacher"), User.id.label("teacher_id"),
               ClassEnrollment.status)
        .join(ClassEnrollment, ClassEnrollment.class_id == Class.id)
        .outerjoin(Course, Course.id == Class.course_id).outerjoin(User, User.id == Class.teacher_id)
        .where(ClassEnrollment.user_id == user.id))).mappings()
    return JSONResponse([dict(r) for r in rows])
