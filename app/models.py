"""Database schema for the Heimatliebe Institute platform.

Every table uses string UUID primary keys so the schema runs unchanged on PostgreSQL and SQLite.
`users.id` is the internal key; `users.user_id` is the human-facing login ID (e.g. HMLI-2026-1234).
"""
from __future__ import annotations

import uuid
from datetime import date as _date, datetime, timezone

from sqlalchemy import (
    JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


def pk() -> Mapped[str]:
    return mapped_column(String(36), primary_key=True, default=uid)


def created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), default=now, index=True)


def fk(target: str, ondelete: str = "CASCADE", nullable: bool = True, index: bool = True) -> Mapped[str | None]:
    return mapped_column(String(36), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=index)


ROLES = ("student", "teacher", "accounts", "hr", "director", "admin", "superadmin")
CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")


# ── People ───────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = pk()
    user_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(254), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    role: Mapped[str] = mapped_column(String(20), default="student", index=True)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active|inactive|suspended|graduated
    password_hash: Mapped[str] = mapped_column(String(200))
    course: Mapped[str | None] = mapped_column(String(120))
    level: Mapped[str | None] = mapped_column(String(40))
    department: Mapped[str | None] = mapped_column(String(120))
    staff_id: Mapped[str | None] = mapped_column(String(40))
    photo_url: Mapped[str | None] = mapped_column(Text)
    date_of_birth: Mapped[_date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(20))
    nationality: Mapped[str | None] = mapped_column(String(80))
    address: Mapped[str | None] = mapped_column(Text)
    guardian_name: Mapped[str | None] = mapped_column(String(200))
    guardian_phone: Mapped[str | None] = mapped_column(String(40))
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Application(Base):
    __tablename__ = "applications"
    id: Mapped[str] = pk()
    reference: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(254), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    course: Mapped[str] = mapped_column(String(120))
    level: Mapped[str] = mapped_column(String(40))
    date_of_birth: Mapped[_date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(20))
    nationality: Mapped[str | None] = mapped_column(String(80))
    address: Mapped[str | None] = mapped_column(Text)
    guardian_name: Mapped[str | None] = mapped_column(String(200))
    guardian_phone: Mapped[str | None] = mapped_column(String(40))
    preferred_schedule: Mapped[str | None] = mapped_column(String(80))  # morning|afternoon|evening|weekend|online
    motivation: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(80))  # how they heard about us
    placement_attempt_id: Mapped[str | None] = mapped_column(String(36))
    payment_proof_url: Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(String(200))
    # pending -> under_review -> interview -> approved | rejected | waitlisted
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    student_id: Mapped[str | None] = mapped_column(String(40))
    notes: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class Enquiry(Base):
    """Front-office CRM: every contact-form / walk-in / phone / WhatsApp enquiry becomes a lead."""
    __tablename__ = "enquiries"
    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(254), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    interest: Mapped[str | None] = mapped_column(String(160))
    message: Mapped[str | None] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(30), default="website")  # website|walk-in|phone|whatsapp|email|social
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)  # new|contacted|follow_up|converted|closed
    assigned_to: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    next_follow_up: Mapped[_date | None] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


# ── Academics ────────────────────────────────────────────────────────────
class Course(Base):
    __tablename__ = "courses"
    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200))
    language: Mapped[str | None] = mapped_column(String(80), index=True)
    level: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str | None] = mapped_column(String(40), default="Enrolling Now")
    schedule: Mapped[str | None] = mapped_column(String(200))
    duration: Mapped[str | None] = mapped_column(String(80))
    fee: Mapped[str | None] = mapped_column(String(80))  # display text, e.g. "MWK 150,000 / term"
    fee_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    capacity: Mapped[int | None] = mapped_column(Integer)
    body: Mapped[str | None] = mapped_column(Text)
    image: Mapped[str | None] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = created()


class Class(Base):
    __tablename__ = "classes"
    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(String(200))
    course_id: Mapped[str | None] = fk("courses.id", ondelete="SET NULL")
    teacher_id: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    level: Mapped[str | None] = mapped_column(String(40))
    room: Mapped[str | None] = mapped_column(String(80))
    schedule: Mapped[str | None] = mapped_column(String(200))
    mode: Mapped[str | None] = mapped_column(String(20), default="in-person")  # in-person|online|hybrid
    meeting_url: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[_date | None] = mapped_column(Date)
    end_date: Mapped[_date | None] = mapped_column(Date)
    max_students: Mapped[int | None] = mapped_column(Integer, default=30)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # planned|active|completed|cancelled
    created_at: Mapped[datetime] = created()


class ClassEnrollment(Base):
    __tablename__ = "class_enrollments"
    __table_args__ = (UniqueConstraint("class_id", "user_id"),)
    id: Mapped[str] = pk()
    class_id: Mapped[str] = fk("classes.id", nullable=False)
    user_id: Mapped[str] = fk("users.id", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)  # active|waitlisted|completed|dropped
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    created_at: Mapped[datetime] = created()


class TimetableEntry(Base):
    __tablename__ = "timetable_entries"
    id: Mapped[str] = pk()
    class_id: Mapped[str | None] = fk("classes.id")
    day_of_week: Mapped[int] = mapped_column(Integer, index=True)  # 0=Sunday … 6=Saturday
    start_time: Mapped[str] = mapped_column(String(5))
    end_time: Mapped[str] = mapped_column(String(5))
    room: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = created()


class Assignment(Base):
    __tablename__ = "assignments"
    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200))
    class_id: Mapped[str | None] = fk("classes.id")
    description: Mapped[str | None] = mapped_column(Text)
    attachment_url: Mapped[str | None] = mapped_column(Text)
    skill: Mapped[str | None] = mapped_column(String(20))  # reading|writing|listening|speaking|grammar|vocabulary
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    total_points: Mapped[int] = mapped_column(Integer, default=100)
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "user_id"),)
    id: Mapped[str] = pk()
    assignment_id: Mapped[str] = fk("assignments.id", nullable=False)
    user_id: Mapped[str] = fk("users.id", nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    file_url: Mapped[str | None] = mapped_column(Text)
    grade: Mapped[float | None] = mapped_column(Float)
    feedback: Mapped[str | None] = mapped_column(Text)
    graded_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class Exam(Base):
    __tablename__ = "exams"
    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200))
    class_id: Mapped[str | None] = fk("classes.id")
    date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    close_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[int | None] = mapped_column(Integer, default=60)
    description: Mapped[str | None] = mapped_column(Text)
    # [{"text": str, "type": "mcq"|"text", "options": [..], "answer": int|str, "points": int}]
    questions: Mapped[list | None] = mapped_column(JSON, default=list)
    pass_mark: Mapped[int] = mapped_column(Integer, default=50)
    published: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class ExamResult(Base):
    __tablename__ = "exam_results"
    __table_args__ = (UniqueConstraint("exam_id", "user_id"),)
    id: Mapped[str] = pk()
    exam_id: Mapped[str] = fk("exams.id", nullable=False)
    user_id: Mapped[str] = fk("users.id", nullable=False)
    title: Mapped[str | None] = mapped_column(String(200))
    answers: Mapped[dict | None] = mapped_column(JSON)
    score: Mapped[float | None] = mapped_column(Float)
    total_points: Mapped[float | None] = mapped_column(Float)
    percentage: Mapped[float | None] = mapped_column(Float)
    passed: Mapped[bool | None] = mapped_column(Boolean)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    feedback: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    graded_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("class_id", "user_id", "date"), Index("ix_attendance_date_status", "date", "status"))
    id: Mapped[str] = pk()
    class_id: Mapped[str | None] = fk("classes.id")
    user_id: Mapped[str] = fk("users.id", nullable=False)
    date: Mapped[_date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(10), default="present")  # present|absent|late|excused
    notes: Mapped[str | None] = mapped_column(Text)
    marked_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class SkillAssessment(Base):
    """CEFR progress tracking: a teacher's periodic rating of each of the four skills."""
    __tablename__ = "skill_assessments"
    id: Mapped[str] = pk()
    user_id: Mapped[str] = fk("users.id", nullable=False)
    class_id: Mapped[str | None] = fk("classes.id")
    term: Mapped[str | None] = mapped_column(String(40))
    reading: Mapped[float | None] = mapped_column(Float)    # 0-100
    writing: Mapped[float | None] = mapped_column(Float)
    listening: Mapped[float | None] = mapped_column(Float)
    speaking: Mapped[float | None] = mapped_column(Float)
    cefr_level: Mapped[str | None] = mapped_column(String(4))
    comments: Mapped[str | None] = mapped_column(Text)
    assessed_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class Certificate(Base):
    __tablename__ = "certificates"
    id: Mapped[str] = pk()
    certificate_no: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    verification_code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    user_id: Mapped[str] = fk("users.id", nullable=False)
    class_id: Mapped[str | None] = fk("classes.id", ondelete="SET NULL")
    course: Mapped[str] = mapped_column(String(200))
    level: Mapped[str | None] = mapped_column(String(40))
    grade: Mapped[str | None] = mapped_column(String(40))
    hours: Mapped[int | None] = mapped_column(Integer)
    issued_at: Mapped[_date] = mapped_column(Date, default=lambda: now().date())
    issued_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()


class CourseEvaluation(Base):
    __tablename__ = "course_evaluations"
    __table_args__ = (UniqueConstraint("class_id", "user_id"),)
    id: Mapped[str] = pk()
    class_id: Mapped[str] = fk("classes.id", nullable=False)
    user_id: Mapped[str] = fk("users.id", nullable=False)
    course_rating: Mapped[int] = mapped_column(Integer)   # 1-5
    teacher_rating: Mapped[int] = mapped_column(Integer)  # 1-5
    comments: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


# ── Placement testing & external exams ───────────────────────────────────
class PlacementAttempt(Base):
    __tablename__ = "placement_attempts"
    id: Mapped[str] = pk()
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(254), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    language: Mapped[str] = mapped_column(String(40))
    answers: Mapped[dict | None] = mapped_column(JSON)
    score: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    recommended_level: Mapped[str] = mapped_column(String(4))
    user_id: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class ExamSession(Base):
    """Official external exam sittings, e.g. Goethe-Zertifikat B1 on 12 Nov."""
    __tablename__ = "exam_sessions"
    id: Mapped[str] = pk()
    provider: Mapped[str] = mapped_column(String(60), default="Goethe-Institut")
    title: Mapped[str] = mapped_column(String(200))
    level: Mapped[str | None] = mapped_column(String(10))
    modules: Mapped[str | None] = mapped_column(String(200))  # "Lesen, Hören, Schreiben, Sprechen"
    exam_date: Mapped[_date] = mapped_column(Date, index=True)
    registration_deadline: Mapped[_date | None] = mapped_column(Date)
    venue: Mapped[str | None] = mapped_column(String(200))
    fee: Mapped[float | None] = mapped_column(Numeric(12, 2))
    capacity: Mapped[int | None] = mapped_column(Integer)
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created()


class ExamRegistration(Base):
    __tablename__ = "exam_registrations"
    id: Mapped[str] = pk()
    session_id: Mapped[str] = fk("exam_sessions.id", nullable=False)
    user_id: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(40))
    date_of_birth: Mapped[_date | None] = mapped_column(Date)
    passport_no: Mapped[str | None] = mapped_column(String(40))
    modules: Mapped[str | None] = mapped_column(String(200))
    payment_proof_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|confirmed|cancelled|sat
    result: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = created()


# ── Finance ──────────────────────────────────────────────────────────────
class Fee(Base):
    __tablename__ = "fees"
    id: Mapped[str] = pk()
    course_id: Mapped[str | None] = fk("courses.id")
    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    frequency: Mapped[str] = mapped_column(String(20), default="term")  # one-time|monthly|term|yearly
    type: Mapped[str] = mapped_column(String(20), default="tuition")  # tuition|application|exam|materials|late_fee|other
    description: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = created()


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[str] = pk()
    invoice_number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    user_id: Mapped[str] = fk("users.id", nullable=False)
    fee_id: Mapped[str | None] = fk("fees.id", ondelete="SET NULL")
    description: Mapped[str | None] = mapped_column(String(200))
    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    discount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)  # scholarships / waivers
    paid: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    due_date: Mapped[_date | None] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|partial|paid|overdue|cancelled
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[str] = pk()
    receipt_no: Mapped[str | None] = mapped_column(String(40), unique=True)
    user_id: Mapped[str] = fk("users.id", nullable=False)
    invoice_id: Mapped[str | None] = fk("invoices.id", ondelete="SET NULL")
    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    method: Mapped[str | None] = mapped_column(String(20))  # airtel|tnm|bank|cash|card
    reference: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(200))
    proof_url: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|confirmed|rejected
    processed_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class Scholarship(Base):
    __tablename__ = "scholarships"
    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    criteria: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    deadline: Mapped[_date | None] = mapped_column(Date)
    open: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created()


class ScholarshipApplication(Base):
    __tablename__ = "scholarship_applications"
    __table_args__ = (UniqueConstraint("scholarship_id", "user_id"),)
    id: Mapped[str] = pk()
    scholarship_id: Mapped[str] = fk("scholarships.id", nullable=False)
    user_id: Mapped[str] = fk("users.id", nullable=False)
    statement: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|awarded|rejected
    created_at: Mapped[datetime] = created()


# ── Communication ────────────────────────────────────────────────────────
class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = pk()
    subject: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class ConversationParticipant(Base):
    __tablename__ = "conversation_participants"
    __table_args__ = (UniqueConstraint("conversation_id", "user_id"),)
    id: Mapped[str] = pk()
    conversation_id: Mapped[str] = fk("conversations.id", nullable=False)
    user_id: Mapped[str] = fk("users.id", nullable=False)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = pk()
    conversation_id: Mapped[str] = fk("conversations.id", nullable=False)
    sender_id: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read"),)
    id: Mapped[str] = pk()
    user_id: Mapped[str] = fk("users.id", nullable=False, index=False)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(20), default="info")
    link: Mapped[str | None] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()


class Announcement(Base):
    __tablename__ = "announcements"
    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    audience: Mapped[str] = mapped_column(String(20), default="all")  # all|students|staff|<role>
    class_id: Mapped[str | None] = fk("classes.id")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[_date | None] = mapped_column(Date)
    created_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


class Event(Base):
    """Academic calendar: term dates, holidays, exam weeks, cultural events."""
    __tablename__ = "events"
    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(20), default="event")  # term|holiday|exam|event|deadline
    start_date: Mapped[_date] = mapped_column(Date, index=True)
    end_date: Mapped[_date | None] = mapped_column(Date)
    public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created()


# ── HR ───────────────────────────────────────────────────────────────────
class LeaveRequest(Base):
    __tablename__ = "leave_requests"
    id: Mapped[str] = pk()
    user_id: Mapped[str] = fk("users.id", nullable=False)
    type: Mapped[str] = mapped_column(String(20), default="annual")  # annual|sick|maternity|study|unpaid|other
    start_date: Mapped[_date] = mapped_column(Date)
    end_date: Mapped[_date] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|approved|rejected
    reviewed_by: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    created_at: Mapped[datetime] = created()


# ── Public website content (CMS) ─────────────────────────────────────────
class LibraryItem(Base):
    __tablename__ = "library"
    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200))
    author: Mapped[str | None] = mapped_column(String(200))
    language: Mapped[str | None] = mapped_column(String(80))
    level: Mapped[str | None] = mapped_column(String(40))
    type: Mapped[str | None] = mapped_column(String(60))
    file_url: Mapped[str | None] = mapped_column(Text)
    cover_url: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    free: Mapped[bool] = mapped_column(Boolean, default=True)
    published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    downloads: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created()


class News(Base):
    __tablename__ = "news"
    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str | None] = mapped_column(String(60))
    summary: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    image: Mapped[str | None] = mapped_column(Text)
    date: Mapped[_date | None] = mapped_column(Date, index=True)
    published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = created()


class GalleryItem(Base):
    __tablename__ = "gallery"
    id: Mapped[str] = pk()
    src: Mapped[str] = mapped_column(Text)
    caption: Mapped[str | None] = mapped_column(String(300))
    category: Mapped[str | None] = mapped_column(String(80))
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created()


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str | None] = mapped_column(String(80))
    file: Mapped[str] = mapped_column(Text)
    date: Mapped[_date | None] = mapped_column(Date, default=lambda: now().date())
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created()


class Testimonial(Base):
    __tablename__ = "testimonials"
    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(String(200))
    course: Mapped[str | None] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    photo: Mapped[str | None] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created()


class Alumnus(Base):
    __tablename__ = "alumni"
    id: Mapped[str] = pk()
    user_id: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(254))
    course: Mapped[str | None] = mapped_column(String(200))
    graduation_year: Mapped[int | None] = mapped_column(Integer, index=True)
    current_job: Mapped[str | None] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = created()


# ── System ───────────────────────────────────────────────────────────────
class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id: Mapped[str] = pk()
    user_id: Mapped[str] = fk("users.id", nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created()


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = pk()
    user_id: Mapped[str | None] = fk("users.id", ondelete="SET NULL")
    action: Mapped[str] = mapped_column(String(40), index=True)
    entity: Mapped[str | None] = mapped_column(String(60), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(36))
    details: Mapped[dict | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = created()


# ── Integrations ─────────────────────────────────────────────────────────
class ExternalApp(Base):
    """A third-party tool shown to users under "Apps": Google Classroom, Drive, Forms, Moodle, H5P, Kahoot …

    `embed` apps open inside the portal (iframe); others open in a new tab.
    `audience` is "all" or a comma-separated list of roles, e.g. "student,teacher".
    """
    __tablename__ = "external_apps"
    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(String(300))
    icon: Mapped[str] = mapped_column(String(40), default="grid")
    audience: Mapped[str] = mapped_column(String(120), default="all")
    embed: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created()


class Webhook(Base):
    """Outgoing notifications to automation tools (Zapier, Make, n8n, Google Apps Script …).

    Each delivery is a JSON POST signed with HMAC-SHA256 of the body using `secret`
    (header `X-Heimatliebe-Signature: sha256=<hex>`), so the receiver can verify it came from us.
    `events` is a comma-separated list, or "*" for all supported events.
    """
    __tablename__ = "webhooks"
    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(Text)
    events: Mapped[str] = mapped_column(String(500), default="*")
    secret: Mapped[str] = mapped_column(String(80), default=lambda: uuid.uuid4().hex + uuid.uuid4().hex)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_status: Mapped[str | None] = mapped_column(String(80))
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created()
