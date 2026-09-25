"""Background scheduler: overdue invoices, fee / deadline / exam reminders, CRM follow-ups, cleanup.

Runs inside the web process (set RUN_SCHEDULER=false on all but one instance when scaling out).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select

from . import mailer, services
from .db import SessionLocal
from .models import Assignment, Enquiry, Exam, Invoice, PasswordResetToken, Submission, User

log = logging.getLogger("hmli.tasks")
INTERVAL = 600  # seconds
_followups_sent_on: date | None = None


async def run_cycle(now: datetime | None = None) -> dict:
    global _followups_sent_on
    now = now or datetime.now(timezone.utc)
    stats = {}
    async with SessionLocal() as db:
        stats["overdue_marked"] = await services.mark_overdue_invoices(db)

        # Assignments due in ~24 h: remind students who haven't submitted (window = one interval → once each).
        lo, hi = now + timedelta(hours=24) - timedelta(seconds=INTERVAL), now + timedelta(hours=24)
        for a in (await db.execute(select(Assignment).where(Assignment.published.is_(True),
                                                            Assignment.due_date > lo, Assignment.due_date <= hi))).scalars():
            students = set(await services.class_student_ids(db, a.class_id))
            done = set((await db.execute(select(Submission.user_id).where(Submission.assignment_id == a.id))).scalars())
            await services.notify(db, students - done, "Assignment due tomorrow", a.title,
                                  "/student/?page=assignments", "reminder")

        # Exams starting in ~24 h.
        for e in (await db.execute(select(Exam).where(Exam.published.is_(True), Exam.date > lo, Exam.date <= hi))).scalars():
            await services.notify(db, await services.class_student_ids(db, e.class_id), "Exam tomorrow", e.title,
                                  "/student/?page=exams", "reminder")

        # Fee reminders: 3 days before due and weekly while overdue.
        week_ago = now - timedelta(days=7)
        stmt = select(Invoice, User).join(User, User.id == Invoice.user_id).where(
            Invoice.status.in_(("pending", "partial", "overdue")),
            Invoice.due_date <= date.today() + timedelta(days=3),
            (Invoice.reminder_sent_at.is_(None)) | (Invoice.reminder_sent_at < week_ago)).limit(500)
        reminded = 0
        for inv, student in (await db.execute(stmt)).all():
            due = services.money(inv.amount) - services.money(inv.discount) - services.money(inv.paid)
            text = f"{inv.invoice_number}: {due:,.0f} " + ("overdue" if inv.status == "overdue" else f"due {inv.due_date:%d %b}")
            await services.notify(db, [student.id], "Fee reminder", text, "/student/?page=payments", "finance")
            if student.email:
                asyncio.create_task(mailer.send_email(
                    student.email, "Fee reminder — Heimatliebe Institute",
                    mailer.layout("Accounts", f"Dear {student.full_name},",
                                  f"<p>Friendly reminder: invoice <strong>{text}</strong>. If you have already paid, "
                                  "please upload your proof of payment in the student portal.</p>")))
            inv.reminder_sent_at = now
            reminded += 1
        stats["fee_reminders"] = reminded

        # CRM: enquiries whose follow-up date is today → nudge the assigned staff member (once per day).
        if _followups_sent_on != date.today():
            rows = (await db.execute(select(Enquiry).where(Enquiry.next_follow_up <= date.today(),
                                                           Enquiry.status.in_(("new", "contacted", "follow_up")),
                                                           Enquiry.assigned_to.is_not(None)))).scalars()
            by_staff: dict[str, int] = {}
            for enq in rows:
                by_staff[enq.assigned_to] = by_staff.get(enq.assigned_to, 0) + 1
            for staff_id, n in by_staff.items():
                await services.notify(db, [staff_id], "Enquiry follow-ups due", f"{n} lead(s) to contact today",
                                      "/admin/?page=enquiries", "crm")
            _followups_sent_on = date.today()

        await db.execute(delete(PasswordResetToken).where(PasswordResetToken.expires_at < now - timedelta(days=1)))
        await db.commit()
    return stats


async def scheduler_loop() -> None:
    await asyncio.sleep(5)
    while True:
        try:
            stats = await run_cycle()
            if any(stats.values()):
                log.info("scheduler: %s", stats)
        except Exception:  # never let the loop die
            log.exception("scheduler cycle failed")
        await asyncio.sleep(INTERVAL)

