"""Generic, policy-enforced data API: `/api/<table>`.

The query language is a safe subset of PostgREST (what the portals already speak):

    GET  /api/payments?status=eq.pending&order=created_at.desc&limit=50&offset=0&count=exact
    GET  /api/users?or=(user_id.eq.HMLI-2026-0001,email.eq.a@b.c)&select=id,full_name
    GET  /api/submissions?expand=user,assignment          (joins FK rows, access-checked)
    GET  /api/users?q=banda                               (search across configured columns)
    POST /api/<table>            {..} or [{..}, ..]
    PATCH/DELETE /api/<table>/<id>

Every request passes through the table's Policy: which roles may read/create/update/delete,
which rows (row-level scope) and which columns (column-level visibility and writability).
"""
from __future__ import annotations

import operator
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import (
    Table, and_, false, func, insert, not_, or_, select, true, update, delete as sa_delete,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from . import services
from .db import get_db
from .models import Base, User, uid
from .responses import JSONResponse
from .security import audit, optional_user

T = Base.metadata.tables
Scope = Callable[[Table, User | None], Any]


# ── Scopes ───────────────────────────────────────────────────────────────
def ALL(t, u):
    return true()


def own(column: str = "user_id") -> Scope:
    return lambda t, u: t.c[column] == u.id


def published(t, u):
    return t.c.published.is_(True)


def teacher_class_ids(u: User):
    c = T["classes"]
    return select(c.c.id).where(c.c.teacher_id == u.id)


def student_class_ids(u: User):
    e = T["class_enrollments"]
    return select(e.c.class_id).where(e.c.user_id == u.id, e.c.status.in_(("active", "completed")))


def teacher_student_ids(u: User):
    e = T["class_enrollments"]
    return select(e.c.user_id).where(e.c.class_id.in_(teacher_class_ids(u)))


def in_teacher_classes(column: str = "class_id") -> Scope:
    return lambda t, u: t.c[column].in_(teacher_class_ids(u))


def in_student_classes(column: str = "class_id") -> Scope:
    return lambda t, u: t.c[column].in_(student_class_ids(u))


def via(parent: str, fk_col: str, parent_scope: Scope) -> Scope:
    """Rows whose `fk_col` points at a row of `parent` that the user may see under `parent_scope`."""
    def scope(t, u):
        p = T[parent]
        return t.c[fk_col].in_(select(p.c.id).where(parent_scope(p, u)))
    return scope


def any_of(*scopes: Scope) -> Scope:
    return lambda t, u: or_(*(s(t, u) for s in scopes))


def all_of(*scopes: Scope) -> Scope:
    return lambda t, u: and_(*(s(t, u) for s in scopes))


# ── Hooks ────────────────────────────────────────────────────────────────
BeforeCreate = Callable[[AsyncSession, User, dict], Awaitable[None]]
AfterWrite = Callable[[AsyncSession, User, str, list[dict]], Awaitable[None]]


@dataclass
class Policy:
    read: dict[str, Scope]
    create: dict[str, Scope] = field(default_factory=dict)
    update: dict[str, Scope] = field(default_factory=dict)
    delete: dict[str, Scope] = field(default_factory=dict)
    hidden: frozenset[str] = frozenset()
    columns: dict[str, frozenset[str]] = field(default_factory=dict)   # role -> visible columns
    writable: dict[str, frozenset[str]] = field(default_factory=dict)  # role -> writable columns
    force: dict[str, Callable[[User], dict]] = field(default_factory=dict)
    search: tuple[str, ...] = ()
    summary: tuple[str, ...] = ()  # columns returned when this table is expanded from another
    transform: Callable[[dict, User | None], dict] | None = None
    before_create: BeforeCreate | None = None
    after_write: AfterWrite | None = None
    public_cache: bool = False


def _role_lookup(mapping: dict, user: User | None, fallback_public: bool = True):
    if user is None:
        return mapping.get("public")
    for key in (user.role, "admin" if user.role == "superadmin" else None, "*", "public" if fallback_public else None):
        if key and key in mapping:
            return mapping[key]
    return None


# ── Table policies ───────────────────────────────────────────────────────
STAFF_READ = {r: ALL for r in ("teacher", "accounts", "hr", "director", "admin")}
MGMT = ("director", "admin")
ADMIN_W = {"admin": ALL}
MGMT_W = {"director": ALL, "admin": ALL}
USER_PUBLIC_COLS = frozenset({"id", "user_id", "full_name", "role", "course", "level", "department",
                              "photo_url", "status"})
USER_STAFF_COLS = USER_PUBLIC_COLS | {"email", "phone", "staff_id", "created_at", "last_login_at"}


def _staff_rows(t, u):
    return t.c.role != "student"


def _classmates_and_staff(t, u):
    e = T["class_enrollments"]
    classmates = select(e.c.user_id).where(e.c.class_id.in_(student_class_ids(u)))
    return or_(t.c.id == u.id, t.c.role != "student", t.c.id.in_(classmates))


def _teacher_visible_users(t, u):
    return or_(t.c.role != "student", t.c.id.in_(teacher_student_ids(u)))


def _set_creator(column: str):
    async def hook(db, user, values):
        values.setdefault(column, user.id)
    return hook


def _exam_for_student(row: dict, user: User | None) -> dict:
    if user is None or user.role != "student":
        return row
    opens = row.get("date")
    if opens and isinstance(opens, datetime):
        if opens.tzinfo is None:
            opens = opens.replace(tzinfo=timezone.utc)
        if opens > datetime.now(timezone.utc):
            row["questions"] = []
            return row
    if "questions" in row:
        row["question_count"] = len(row["questions"] or [])
        row["questions"] = [{k: v for k, v in q.items() if k not in ("answer", "explanation")}
                            for q in (row["questions"] or []) if isinstance(q, dict)]
    return row


async def _before_invoice(db, user, values):
    values.setdefault("created_by", user.id)
    if not values.get("invoice_number"):
        values["invoice_number"] = await services.next_invoice_number(db)
    values["status"] = values.get("status") or services.invoice_status(
        services.money(values.get("amount")) - services.money(values.get("discount")),
        services.money(values.get("paid")), values.get("due_date"))


async def _after_invoice(db, user, op, rows):
    if op != "delete":
        for r in rows:
            await services.recompute_invoice(db, r["id"])
    if op == "create":
        for r in rows:
            await services.notify(db, [r["user_id"]], "New invoice",
                                  f"{r.get('description') or 'Invoice'} — {services.money(r.get('amount')):,.0f}",
                                  "/student/?page=payments", "finance")


async def _before_payment(db, user, values):
    values.setdefault("processed_by", user.id)
    if values.get("status", "confirmed") == "confirmed":
        values["status"] = "confirmed"
        values["confirmed_at"] = services.utcnow()
        values["receipt_no"] = values.get("receipt_no") or await services.next_receipt_no(db)


async def _after_payment(db, user, op, rows):
    for r in rows:
        await services.recompute_invoice(db, r.get("invoice_id"))
        if op != "delete" and r.get("status") in ("confirmed", "rejected"):
            await services.notify(db, [r["user_id"]], f"Payment {r['status']}",
                                  f"{services.money(r.get('amount')):,.0f} via {r.get('method') or '—'}",
                                  "/student/?page=payments", "finance")


async def _after_assignment(db, user, op, rows):
    if op != "create":
        return
    for r in rows:
        if r.get("published", True):
            students = await services.class_student_ids(db, r.get("class_id"))
            await services.notify(db, students, "New assignment", r.get("title", ""),
                                  "/student/?page=assignments", "academic")


async def _after_exam(db, user, op, rows):
    for r in rows:
        if op == "update" and r.get("published"):
            students = await services.class_student_ids(db, r.get("class_id"))
            await services.notify(db, students, "Exam published", r.get("title", ""),
                                  "/student/?page=exams", "academic")


async def _after_submission(db, user, op, rows):
    for r in rows:
        if op == "update" and user.role != "student" and r.get("grade") is not None:
            await services.notify(db, [r["user_id"]], "Assignment graded",
                                  f"Score: {r['grade']}", "/student/?page=assignments", "academic")
        if op == "create" and user.role == "student":
            a = T["assignments"]; c = T["classes"]
            teacher = (await db.execute(select(c.c.teacher_id).join(a, a.c.class_id == c.c.id)
                                        .where(a.c.id == r["assignment_id"]))).scalar_one_or_none()
            await services.notify(db, [teacher], "New submission", user.full_name,
                                  "/teacher/?page=grading", "academic")


async def _before_submission(db, user, values):
    if user.role == "student":
        values["user_id"] = user.id
        values["submitted_at"] = services.utcnow()
        values.pop("grade", None)


async def _after_announcement(db, user, op, rows):
    if op == "create":
        for r in rows:
            services.queue_event(db, "announcement", {"title": r.get("title"), "body": r.get("body")},
                                 roles=("student", "teacher", "accounts", "hr", "director", "admin"))


async def _after_public_content(db, user, op, rows):
    services.public_cache_clear()


async def _before_leave(db, user, values):
    if user.role not in ("hr", "admin", "superadmin"):
        values["user_id"] = user.id
        values["status"] = "pending"


async def _after_leave(db, user, op, rows):
    if op == "create":
        services.queue_event(db, "leave.new", {"count": len(rows)}, roles=("hr",))
    elif op == "update":
        for r in rows:
            await services.notify(db, [r["user_id"]], f"Leave request {r['status']}",
                                  f"{r['start_date']} → {r['end_date']}", None, "hr")


async def _before_evaluation(db, user, values):
    values["user_id"] = user.id


def _announcement_scope(t, u):
    role_match = or_(t.c.audience == "all", t.c.audience == u.role,
                     and_(t.c.audience == "students", u.role == "student"),
                     and_(t.c.audience == "staff", u.role != "student"))
    cls = or_(t.c.class_id.is_(None), t.c.class_id.in_(student_class_ids(u) if u.role == "student" else teacher_class_ids(u)))
    return and_(t.c.published.is_(True), role_match, cls)


def _conversation_member(t, u):
    p = T["conversation_participants"]
    return t.c.id.in_(select(p.c.conversation_id).where(p.c.user_id == u.id))


def _conv_child(column: str = "conversation_id") -> Scope:
    def scope(t, u):
        p = T["conversation_participants"]
        return t.c[column].in_(select(p.c.conversation_id).where(p.c.user_id == u.id))
    return scope


def _library_item(row: dict, user: User | None) -> dict:
    """Resources not marked free are only downloadable by signed-in users."""
    if user is None and row.get("free") is False:
        row["file_url"] = None
    return row


def _app_for_role(t, u):
    """Active apps whose audience is everyone or includes the user's role."""
    return and_(t.c.active.is_(True), or_(t.c.audience == "all", t.c.audience.contains(u.role)))


async def _after_webhook(db, user, op, rows):
    from . import webhooks
    webhooks.forget_cache()


POLICIES: dict[str, Policy] = {
    "users": Policy(
        read={"student": _classmates_and_staff, "teacher": _teacher_visible_users, "accounts": ALL,
              "hr": ALL, "director": ALL, "admin": ALL},
        update={"admin": ALL, "hr": ALL},
        delete={"admin": lambda t, u: t.c.id != u.id},
        hidden=frozenset({"password_hash"}),
        columns={"student": USER_PUBLIC_COLS, "teacher": USER_STAFF_COLS, "accounts": USER_STAFF_COLS},
        writable={"admin": frozenset({"full_name", "email", "phone", "role", "status", "course", "level",
                                      "department", "staff_id", "photo_url", "date_of_birth", "gender",
                                      "nationality", "address", "guardian_name", "guardian_phone"}),
                  "hr": frozenset({"full_name", "email", "phone", "status", "course", "level", "department",
                                   "staff_id", "photo_url", "date_of_birth", "gender", "nationality", "address",
                                   "guardian_name", "guardian_phone"})},
        search=("full_name", "user_id", "email", "phone"),
        summary=("id", "user_id", "full_name", "email", "phone", "role", "course", "level", "photo_url"),
    ),
    "applications": Policy(
        read={"admin": ALL, "director": ALL, "accounts": ALL, "hr": ALL},
        update={"admin": ALL},
        delete={"admin": ALL},
        hidden=frozenset({"password_hash"}),
        writable={"admin": frozenset({"status", "notes", "course", "level", "phone", "email", "full_name",
                                      "preferred_schedule"})},
        search=("full_name", "email", "phone", "reference"),
        summary=("id", "reference", "full_name", "email", "course", "level", "status"),
    ),
    "enquiries": Policy(
        read={"admin": ALL, "director": ALL, "hr": ALL, "accounts": ALL},
        create={"admin": ALL, "director": ALL, "hr": ALL, "accounts": ALL},
        update={"admin": ALL, "director": ALL, "hr": ALL, "accounts": ALL},
        delete={"admin": ALL},
        search=("name", "email", "phone", "interest"),
    ),
    "courses": Policy(read={"public": published, **STAFF_READ}, create=MGMT_W, update=MGMT_W, delete=ADMIN_W,
                      search=("title", "language", "level"), summary=("id", "title", "language", "level", "fee_amount"),
                      after_write=_after_public_content, public_cache=True),
    "classes": Policy(
        read={**STAFF_READ, "student": lambda t, u: t.c.id.in_(student_class_ids(u))},
        create=MGMT_W, update={**MGMT_W, "teacher": lambda t, u: t.c.teacher_id == u.id}, delete=ADMIN_W,
        writable={"teacher": frozenset({"meeting_url", "room", "schedule"})},
        search=("name", "room", "level"),
        summary=("id", "name", "course_id", "teacher_id", "level", "room", "schedule", "meeting_url", "mode"),
    ),
    "class_enrollments": Policy(
        read={"admin": ALL, "director": ALL, "hr": ALL, "accounts": ALL,
              "teacher": in_teacher_classes(), "student": own()},
        create=MGMT_W, update=MGMT_W, delete=MGMT_W,
    ),
    "timetable_entries": Policy(
        read={**STAFF_READ, "student": in_student_classes()},
        create=MGMT_W, update=MGMT_W, delete=MGMT_W,
    ),
    "assignments": Policy(
        read={"admin": ALL, "director": ALL, "teacher": in_teacher_classes(),
              "student": all_of(lambda t, u: t.c.published.is_(True),
                                any_of(lambda t, u: t.c.class_id.is_(None), in_student_classes()))},
        create={"admin": ALL, "teacher": in_teacher_classes()},
        update={"admin": ALL, "teacher": in_teacher_classes()},
        delete={"admin": ALL, "teacher": in_teacher_classes()},
        before_create=_set_creator("created_by"), after_write=_after_assignment,
        search=("title",), summary=("id", "title", "class_id", "due_date", "total_points", "skill"),
    ),
    "submissions": Policy(
        read={"admin": ALL, "director": ALL,
              "teacher": via("assignments", "assignment_id", in_teacher_classes()), "student": own()},
        create={"student": all_of(own(), via("assignments", "assignment_id", in_student_classes()))},
        update={"admin": ALL, "teacher": via("assignments", "assignment_id", in_teacher_classes()),
                "student": all_of(own(), lambda t, u: t.c.grade.is_(None))},
        delete={"admin": ALL},
        writable={"student": frozenset({"assignment_id", "content", "file_url"}),
                  "teacher": frozenset({"grade", "feedback", "graded_by", "graded_at"})},
        before_create=_before_submission, after_write=_after_submission,
    ),
    "exams": Policy(
        read={"admin": ALL, "director": ALL, "teacher": in_teacher_classes(),
              "student": all_of(published, any_of(lambda t, u: t.c.class_id.is_(None), in_student_classes()))},
        create={"admin": ALL, "teacher": in_teacher_classes()},
        update={"admin": ALL, "teacher": in_teacher_classes()},
        delete={"admin": ALL, "teacher": in_teacher_classes()},
        transform=_exam_for_student, before_create=_set_creator("created_by"), after_write=_after_exam,
        search=("title",), summary=("id", "title", "class_id", "date", "duration_minutes", "pass_mark"),
    ),
    "exam_results": Policy(
        read={"admin": ALL, "director": ALL, "teacher": via("exams", "exam_id", in_teacher_classes()),
              "student": own()},
        update={"admin": ALL, "teacher": via("exams", "exam_id", in_teacher_classes())},
        delete={"admin": ALL},
        writable={"teacher": frozenset({"score", "percentage", "passed", "needs_review", "feedback",
                                        "graded_by", "graded_at"})},
    ),
    "attendance": Policy(
        read={"admin": ALL, "director": ALL, "hr": ALL, "teacher": in_teacher_classes(), "student": own()},
        create={"admin": ALL, "teacher": in_teacher_classes()},
        update={"admin": ALL, "teacher": in_teacher_classes()},
        delete={"admin": ALL, "teacher": in_teacher_classes()},
        before_create=_set_creator("marked_by"),
    ),
    "skill_assessments": Policy(
        read={"admin": ALL, "director": ALL, "teacher": lambda t, u: t.c.user_id.in_(teacher_student_ids(u)),
              "student": own()},
        create={"admin": ALL, "teacher": lambda t, u: t.c.user_id.in_(teacher_student_ids(u))},
        update={"admin": ALL, "teacher": own("assessed_by")},
        delete={"admin": ALL, "teacher": own("assessed_by")},
        before_create=_set_creator("assessed_by"),
    ),
    "certificates": Policy(
        read={"admin": ALL, "director": ALL, "hr": ALL, "student": all_of(own(), lambda t, u: t.c.revoked.is_(False))},
        update=MGMT_W, delete=ADMIN_W,
        writable={"director": frozenset({"revoked", "grade", "hours"}), "admin": frozenset({"revoked", "grade", "hours"})},
        search=("certificate_no", "course"),
    ),
    "course_evaluations": Policy(
        read={"admin": ALL, "director": ALL, "teacher": in_teacher_classes(), "student": own()},
        create={"student": all_of(own(), in_student_classes())},
        delete=ADMIN_W,
        columns={"teacher": frozenset({"id", "class_id", "course_rating", "teacher_rating", "comments", "created_at"})},
        before_create=_before_evaluation,
    ),
    "placement_attempts": Policy(read={"admin": ALL, "director": ALL, "teacher": ALL}, delete=ADMIN_W,
                                 search=("full_name", "email", "phone")),
    "exam_sessions": Policy(read={"public": published, **STAFF_READ}, create=MGMT_W, update=MGMT_W, delete=ADMIN_W,
                            summary=("id", "title", "provider", "level", "exam_date", "fee"),
                            after_write=_after_public_content),
    "exam_registrations": Policy(
        read={"admin": ALL, "director": ALL, "accounts": ALL, "student": own()},
        update={"admin": ALL, "accounts": ALL}, delete=ADMIN_W,
        writable={"accounts": frozenset({"status"}), "admin": frozenset({"status", "result", "modules"})},
        search=("full_name", "email", "phone"),
    ),
    "fees": Policy(read={**STAFF_READ, "student": ALL}, create={"accounts": ALL, "admin": ALL},
                   update={"accounts": ALL, "admin": ALL}, delete={"accounts": ALL, "admin": ALL},
                   summary=("id", "description", "amount", "frequency", "type")),
    "invoices": Policy(
        read={"accounts": ALL, "admin": ALL, "director": ALL, "student": own()},
        create={"accounts": ALL, "admin": ALL}, update={"accounts": ALL, "admin": ALL},
        delete={"accounts": lambda t, u: t.c.paid == 0, "admin": ALL},
        writable={"accounts": frozenset({"user_id", "fee_id", "description", "amount", "discount", "due_date",
                                         "status", "invoice_number"})},
        before_create=_before_invoice, after_write=_after_invoice,
        search=("invoice_number", "description"),
        summary=("id", "invoice_number", "description", "amount", "discount", "paid", "status", "due_date"),
    ),
    "payments": Policy(
        read={"accounts": ALL, "admin": ALL, "director": ALL, "student": own()},
        create={"accounts": ALL, "admin": ALL}, update={"accounts": ALL, "admin": ALL},
        delete={"admin": ALL},
        writable={"accounts": frozenset({"user_id", "invoice_id", "amount", "method", "reference", "description",
                                         "proof_url", "status"})},
        before_create=_before_payment, after_write=_after_payment,
        search=("reference", "description", "receipt_no"),
    ),
    "scholarships": Policy(read={**STAFF_READ, "student": ALL}, create=MGMT_W, update=MGMT_W, delete=ADMIN_W,
                           summary=("id", "title", "amount", "deadline", "open")),
    "scholarship_applications": Policy(
        read={"admin": ALL, "director": ALL, "accounts": ALL, "student": own()},
        create={"student": own()}, update=MGMT_W, delete=ADMIN_W,
        writable={"student": frozenset({"scholarship_id", "statement"}),
                  "admin": frozenset({"status"}), "director": frozenset({"status"})},
        force={"student": lambda u: {"user_id": u.id, "status": "pending"}},
    ),
    "conversations": Policy(read={"*": _conversation_member, "admin": ALL}, summary=("id", "subject", "updated_at")),
    "conversation_participants": Policy(read={"*": _conv_child(), "admin": ALL}),
    "messages": Policy(read={"*": _conv_child(), "admin": ALL}),
    "notifications": Policy(read={"*": own()}, update={"*": own()}, delete={"*": own()},
                            writable={"*": frozenset({"read"})}),
    "announcements": Policy(
        read={"*": _announcement_scope, "admin": ALL, "director": ALL},
        create={"admin": ALL, "director": ALL, "hr": ALL,
                "teacher": lambda t, u: t.c.class_id.in_(teacher_class_ids(u))},
        update={"admin": ALL, "director": ALL, "teacher": own("created_by"), "hr": own("created_by")},
        delete={"admin": ALL, "director": ALL, "teacher": own("created_by"), "hr": own("created_by")},
        before_create=_set_creator("created_by"), after_write=_after_announcement,
    ),
    "events": Policy(read={"public": lambda t, u: t.c.public.is_(True), "*": ALL}, create=MGMT_W, update=MGMT_W,
                     delete=MGMT_W, after_write=_after_public_content),
    "leave_requests": Policy(
        read={"hr": ALL, "admin": ALL, "director": ALL, "*": own()},
        create={"hr": ALL, "admin": ALL, "teacher": own(), "accounts": own(), "director": own()},
        update={"hr": ALL, "admin": ALL, "*": all_of(own(), lambda t, u: t.c.status == "pending")},
        delete={"admin": ALL, "*": all_of(own(), lambda t, u: t.c.status == "pending")},
        writable={"hr": frozenset({"status", "reviewed_by"}), "admin": frozenset({"status", "reviewed_by"}),
                  "*": frozenset({"type", "start_date", "end_date", "reason"})},
        before_create=_before_leave, after_write=_after_leave,
    ),
    "library": Policy(read={"public": published, **STAFF_READ}, create=MGMT_W, update=MGMT_W, delete=MGMT_W,
                      search=("title", "author", "language", "description"), after_write=_after_public_content,
                      transform=_library_item, public_cache=True),
    "news": Policy(read={"public": published, **STAFF_READ}, create=MGMT_W, update=MGMT_W, delete=MGMT_W,
                   search=("title", "summary"), after_write=_after_public_content, public_cache=True),
    "gallery": Policy(read={"public": published, **STAFF_READ}, create=MGMT_W, update=MGMT_W, delete=MGMT_W,
                      after_write=_after_public_content, public_cache=True),
    "documents": Policy(read={"public": published, **STAFF_READ}, create=MGMT_W, update=MGMT_W, delete=MGMT_W,
                        after_write=_after_public_content, public_cache=True),
    "testimonials": Policy(read={"public": published, **STAFF_READ}, create=MGMT_W, update=MGMT_W, delete=MGMT_W,
                           after_write=_after_public_content, public_cache=True),
    "alumni": Policy(read={**STAFF_READ}, create=ADMIN_W, update=ADMIN_W, delete=ADMIN_W,
                     search=("full_name", "email", "course")),
    "audit_logs": Policy(read={"admin": ALL, "director": ALL}, search=("action", "entity")),
    "external_apps": Policy(
        read={"*": _app_for_role, "admin": ALL}, create=ADMIN_W, update=ADMIN_W, delete=ADMIN_W,
        search=("name", "description"),
    ),
    "webhooks": Policy(read={"admin": ALL}, create=ADMIN_W, update=ADMIN_W, delete=ADMIN_W,
                       after_write=_after_webhook),
}

READ_ONLY_COLUMNS = frozenset({"id", "created_at", "updated_at"})


# ── Query parsing ────────────────────────────────────────────────────────
RESERVED = {"select", "order", "limit", "offset", "count", "expand", "q", "or", "and", "_", ""}
MAX_LIMIT = 2000
DEFAULT_LIMIT = 500


def _split_top(s: str) -> list[str]:
    parts, depth, cur = [], 0, []
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur)); cur = []
        else:
            cur.append(ch)
    if cur:
        parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def coerce(column, value):
    """Convert text/JSON input into the Python type the column expects."""
    if value is None:
        return None
    try:
        py = column.type.python_type
    except NotImplementedError:
        return value
    if isinstance(value, str) and value == "" and py is not str:
        return None
    try:
        if py is bool:
            if isinstance(value, bool):
                return value
            return str(value).lower() in ("true", "1", "yes", "on")
        if py is int:
            return int(value)
        if py in (float, Decimal):
            return float(value)
        if py is datetime:
            if isinstance(value, datetime):
                return value
            v = str(value).replace("Z", "+00:00")
            dt = datetime.fromisoformat(v if "T" in v or " " in v else v + "T00:00:00")
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        if py is date:
            if isinstance(value, date) and not isinstance(value, datetime):
                return value
            return date.fromisoformat(str(value)[:10])
        if py is str:
            return str(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"Invalid value for {column.name}: {value!r}")
    return value


_OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"}
_CMP = {"eq": operator.eq, "neq": operator.ne, "gt": operator.gt, "gte": operator.ge, "lt": operator.lt, "lte": operator.le}


def _condition(t: Table, visible: set[str], colname: str, expr: str):
    if colname not in visible:
        raise HTTPException(400, f"Unknown or restricted column: {colname}")
    col = t.c[colname]
    negate = False
    if expr.startswith("not."):
        negate, expr = True, expr[4:]
    op, sep, arg = expr.partition(".")
    if not sep or op not in _OPS:
        op, arg = "eq", expr  # bare value means equality
    if op == "is":
        low = arg.lower()
        cond = col.is_(None) if low == "null" else col.is_(low == "true")
    elif op == "in":
        items = [x.strip().strip('"') for x in arg.strip("()").split(",") if x.strip()]
        cond = col.in_([coerce(col, x) for x in items]) if items else false()
    elif op in ("like", "ilike"):
        pattern = arg.replace("*", "%")
        cond = col.ilike(pattern) if op == "ilike" else col.like(pattern)
    else:
        v = coerce(col, arg)
        cond = _CMP[op](col, v)
    return not_(cond) if negate else cond


def _group(t, visible, raw: str, joiner):
    conds = []
    for part in _split_top(raw.strip()[1:-1] if raw.strip().startswith("(") else raw):
        if part.startswith(("or(", "and(")):
            name, inner = part.split("(", 1)
            conds.append(_group(t, visible, "(" + inner, or_ if name == "or" else and_))
            continue
        colname, _, expr = part.partition(".")
        conds.append(_condition(t, visible, colname, expr))
    return joiner(*conds) if conds else true()


def _order(t, visible, raw: str):
    out = []
    for part in raw.split(","):
        bits = part.strip().split(".")
        if not bits[0]:
            continue
        if bits[0] not in visible:
            raise HTTPException(400, f"Cannot order by {bits[0]}")
        c = t.c[bits[0]]
        o = c.desc() if "desc" in bits[1:] else c.asc()
        if "nullslast" in bits[1:]:
            o = o.nulls_last()
        elif "nullsfirst" in bits[1:]:
            o = o.nulls_first()
        out.append(o)
    return out


# ── Helpers ──────────────────────────────────────────────────────────────
def policy_for(table: str) -> Policy:
    pol = POLICIES.get(table)
    if pol is None or table not in T:
        raise HTTPException(404, f"Unknown resource: {table}")
    return pol


def visible_columns(pol: Policy, t: Table, user: User | None) -> set[str]:
    cols = {c.name for c in t.columns} - set(pol.hidden)
    restrict = _role_lookup(pol.columns, user)
    return cols & set(restrict) if restrict else cols


def read_scope(pol: Policy, t: Table, user: User | None):
    scope = _role_lookup(pol.read, user)
    if scope is None:
        raise HTTPException(401 if user is None else 403, "Not authenticated." if user is None else "Access denied.")
    return scope(t, user)


def write_scope(pol: Policy, op: str, t: Table, user: User | None):
    if user is None:
        raise HTTPException(401, "Not authenticated.")
    scope = _role_lookup(getattr(pol, op), user, fallback_public=False)
    if scope is None:
        raise HTTPException(403, "You do not have permission to change this data.")
    return scope(t, user)


def clean_values(pol: Policy, t: Table, user: User, body: dict, creating: bool) -> dict:
    if not isinstance(body, dict):
        raise HTTPException(400, "Expected a JSON object.")
    allowed = _role_lookup(pol.writable, user, fallback_public=False)
    cols = {c.name: c for c in t.columns}
    out = {}
    for k, v in body.items():
        if k not in cols or k in pol.hidden or k in READ_ONLY_COLUMNS:
            continue
        if allowed is not None and k not in allowed:
            continue
        out[k] = coerce(cols[k], v)
    forced = _role_lookup(pol.force, user, fallback_public=False)
    if forced and creating:
        out.update(forced(user))
    return out


async def fetch_rows(db: AsyncSession, table: str, user: User | None, ids: list[str]) -> list[dict]:
    pol = POLICIES[table]
    t = T[table]
    cols = visible_columns(pol, t, user)
    stmt = select(*[t.c[c] for c in sorted(cols)]).where(t.c.id.in_(ids))
    rows = [dict(r) for r in (await db.execute(stmt)).mappings()]
    return [pol.transform(r, user) for r in rows] if pol.transform else rows


async def expand_rows(db: AsyncSession, t: Table, rows: list[dict], names: list[str], user: User | None) -> None:
    for name in names:
        col = t.c.get(name + "_id") if (name + "_id") in t.c else t.c.get(name)
        if col is None or not col.foreign_keys:
            raise HTTPException(400, f"Cannot expand {name}")
        target = next(iter(col.foreign_keys)).column.table
        tpol = POLICIES.get(target.name)
        key = name if col.name != name else name + "_ref"
        ids = {r.get(col.name) for r in rows if r.get(col.name)}
        found: dict[str, dict] = {}
        if ids and tpol is not None:
            try:
                scope = read_scope(tpol, target, user)
            except HTTPException:
                scope = None
            if scope is not None:
                vis = visible_columns(tpol, target, user)
                cols = [c for c in (tpol.summary or sorted(vis)) if c in vis]
                if "id" not in cols:
                    cols.insert(0, "id")
                stmt = select(*[target.c[c] for c in cols]).where(target.c.id.in_(ids), scope)
                found = {r["id"]: dict(r) for r in (await db.execute(stmt)).mappings()}
        for r in rows:
            r[key] = found.get(r.get(col.name))


# ── Routes ───────────────────────────────────────────────────────────────
router = APIRouter(tags=["data"])


@router.get("/api/{table}")
async def list_rows(table: str, request: Request, user: User | None = Depends(optional_user),
                    db: AsyncSession = Depends(get_db)):
    pol = policy_for(table)
    t = T[table]
    scope = read_scope(pol, t, user)
    visible = visible_columns(pol, t, user)
    params = request.query_params

    cache_key = None
    if user is None and pol.public_cache:
        cache_key = f"rest:{table}?{request.url.query}"
        cached = services.public_cache_get(cache_key)
        if cached is not None:
            return JSONResponse(cached, headers={"Cache-Control": "public, max-age=30"})

    chosen = visible
    if params.get("select") and params["select"] != "*":
        chosen = {c.strip() for c in params["select"].split(",") if c.strip()} & visible or visible
    conds = [scope]
    for key, value in params.multi_items():
        if key in RESERVED:
            continue
        conds.append(_condition(t, visible, key, value))
    for key, joiner in (("or", or_), ("and", and_)):
        for raw in params.getlist(key):
            conds.append(_group(t, visible, raw, joiner))
    if params.get("q") and pol.search:
        term = f"%{params['q'].strip()}%"
        conds.append(or_(*(t.c[c].ilike(term) for c in pol.search if c in visible)))

    where = and_(*conds)
    try:
        limit = min(int(params.get("limit", DEFAULT_LIMIT)), MAX_LIMIT)
        offset = max(int(params.get("offset", 0)), 0)
    except ValueError:
        raise HTTPException(400, "limit/offset must be integers")
    order = _order(t, visible, params["order"]) if params.get("order") else (
        [t.c.created_at.desc()] if "created_at" in t.c else [])

    stmt = select(*[t.c[c] for c in sorted(chosen | ({"id"} & visible))]).where(where).order_by(*order)
    stmt = stmt.limit(limit).offset(offset)
    rows = [dict(r) for r in (await db.execute(stmt)).mappings()]
    if pol.transform:
        rows = [pol.transform(r, user) for r in rows]
    if params.get("expand"):
        await expand_rows(db, t, rows, [n.strip() for n in params["expand"].split(",") if n.strip()], user)

    headers = {}
    if params.get("count") == "exact":
        total = (await db.execute(select(func.count()).select_from(t).where(where))).scalar_one()
        headers["X-Total-Count"] = str(total)
        headers["Access-Control-Expose-Headers"] = "X-Total-Count"
    if cache_key:
        services.public_cache_put(cache_key, rows)
        headers["Cache-Control"] = "public, max-age=30"
    else:
        headers["Cache-Control"] = "no-store"
    return JSONResponse(rows, headers=headers)


@router.get("/api/{table}/{row_id}")
async def get_row(table: str, row_id: str, request: Request, user: User | None = Depends(optional_user),
                  db: AsyncSession = Depends(get_db)):
    pol = policy_for(table)
    t = T[table]
    scope = read_scope(pol, t, user)
    visible = visible_columns(pol, t, user)
    row = (await db.execute(select(*[t.c[c] for c in sorted(visible)]).where(t.c.id == row_id, scope))).mappings().first()
    if row is None:
        raise HTTPException(404, "Not found.")
    row = dict(row)
    if pol.transform:
        row = pol.transform(row, user)
    if request.query_params.get("expand"):
        await expand_rows(db, t, [row], request.query_params["expand"].split(","), user)
    return JSONResponse(row)


async def _check_scope(db, t, ids, scope) -> None:
    n = (await db.execute(select(func.count()).select_from(t).where(t.c.id.in_(ids), scope))).scalar_one()
    if n != len(ids):
        await db.rollback()
        raise HTTPException(403, "That change is outside what you are allowed to manage.")


def _integrity_message(exc: IntegrityError) -> str:
    msg = str(exc.orig).lower()
    if "unique" in msg or "duplicate" in msg:
        return "A record with these details already exists."
    if "foreign key" in msg:
        return "A referenced record does not exist."
    if "not null" in msg:
        m = re.search(r"(?:column|\.)\"?(\w+)\"?", str(exc.orig).split("NOT NULL")[-1]) if "NOT NULL" in str(exc.orig) else None
        return "A required field is missing" + (f": {m.group(1)}" if m else ".")
    return "The data could not be saved."


@router.post("/api/{table}", status_code=201)
async def create_rows(table: str, request: Request, user: User | None = Depends(optional_user),
                      db: AsyncSession = Depends(get_db)):
    pol = policy_for(table)
    t = T[table]
    scope = write_scope(pol, "create", t, user)
    body = await request.json()
    items = body if isinstance(body, list) else [body]
    if not items or len(items) > 1000:
        raise HTTPException(400, "Send between 1 and 1000 records.")
    ids = []
    try:
        for item in items:
            values = clean_values(pol, t, user, item, creating=True)
            if pol.before_create:
                await pol.before_create(db, user, values)
            values["id"] = uid()
            await db.execute(insert(t).values(**values))
            ids.append(values["id"])
        await _check_scope(db, t, ids, scope)
        rows = await fetch_rows(db, table, user, ids)
        if pol.after_write:
            await pol.after_write(db, user, "create", rows)
        await audit(db, request, user, "create", table, ids[0] if len(ids) == 1 else None, {"count": len(ids)})
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, _integrity_message(exc))
    if pol.after_write:
        rows = await fetch_rows(db, table, user, ids)
    return JSONResponse(rows, status_code=201)


async def _update(table: str, request: Request, user: User | None, db: AsyncSession, id_filter) -> JSONResponse:
    pol = policy_for(table)
    t = T[table]
    scope = write_scope(pol, "update", t, user)
    values = clean_values(pol, t, user, await request.json(), creating=False)
    if not values:
        raise HTTPException(400, "Nothing to update (no permitted fields supplied).")
    if "updated_at" in t.c:
        values["updated_at"] = services.utcnow()
    ids = list((await db.execute(select(t.c.id).where(id_filter, scope))).scalars())
    if not ids:
        raise HTTPException(404, "Not found or not permitted.")
    try:
        await db.execute(update(t).where(t.c.id.in_(ids)).values(**values))
        await _check_scope(db, t, ids, scope)
        rows = await fetch_rows(db, table, user, ids)
        if pol.after_write:
            await pol.after_write(db, user, "update", rows)
        await audit(db, request, user, "update", table, ids[0] if len(ids) == 1 else None,
                    {"fields": sorted(values)})
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, _integrity_message(exc))
    if table == "users":
        from .security import forget_user
        for i in ids:
            forget_user(i)
    return JSONResponse(await fetch_rows(db, table, user, ids))


@router.patch("/api/{table}/{row_id}")
async def update_row(table: str, row_id: str, request: Request, user: User | None = Depends(optional_user),
                     db: AsyncSession = Depends(get_db)):
    return await _update(table, request, user, db, T[table].c.id == row_id if table in T else true())


@router.delete("/api/{table}/{row_id}")
async def delete_row(table: str, row_id: str, request: Request, user: User | None = Depends(optional_user),
                     db: AsyncSession = Depends(get_db)):
    pol = policy_for(table)
    t = T[table]
    scope = write_scope(pol, "delete", t, user)
    rows = await fetch_rows(db, table, user, [row_id])
    try:
        res = await db.execute(sa_delete(t).where(t.c.id == row_id, scope))
        if not res.rowcount:
            raise HTTPException(404, "Not found or not permitted.")
        if pol.after_write:
            await pol.after_write(db, user, "delete", rows)
        await audit(db, request, user, "delete", table, row_id)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "This record is still referenced by other data. " + _integrity_message(exc))
    return {"ok": True}
