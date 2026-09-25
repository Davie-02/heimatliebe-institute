"""Fees, invoices, payments, receipts and financial reporting."""
from __future__ import annotations

import html
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import mailer, services
from ..db import get_db
from ..models import ClassEnrollment, Course, Fee, Invoice, Payment, User
from ..responses import JSONResponse
from ..security import audit, current_user, require_roles
from .academics import PRINT_CSS, _esc

router = APIRouter(tags=["finance"])
FINANCE = ("accounts", "admin", "director")


class PaymentSubmitIn(BaseModel):
    invoice_id: str | None = None
    amount: float = Field(gt=0, le=100_000_000)
    method: str = Field(pattern="^(airtel|tnm|bank|cash|card)$")
    reference: str | None = Field(None, max_length=120)
    description: str | None = Field(None, max_length=200)
    proof_url: str | None = Field(None, max_length=1000)


@router.post("/api/payments/submit", status_code=201)
async def submit_payment(body: PaymentSubmitIn, request: Request, user: User = Depends(require_roles("student")),
                         db: AsyncSession = Depends(get_db)):
    """A student reports a mobile-money / bank payment with proof; accounts then confirms it."""
    if body.invoice_id:
        inv = await db.get(Invoice, body.invoice_id)
        if not inv or inv.user_id != user.id:
            raise HTTPException(404, "Invoice not found.")
    p = Payment(user_id=user.id, status="pending", **body.model_dump())
    db.add(p)
    services.queue_event(db, "payment.new", {"name": user.full_name, "amount": body.amount}, roles=("accounts",))
    await audit(db, request, user, "payment.submit", "payments", p.id, {"amount": body.amount})
    await db.commit()
    return {"ok": True, "id": p.id}


async def _payment_or_404(db, payment_id) -> Payment:
    p = await db.get(Payment, payment_id)
    if not p:
        raise HTTPException(404, "Payment not found.")
    return p


@router.post("/api/payments/{payment_id}/confirm")
async def confirm(payment_id: str, request: Request, background: BackgroundTasks,
                  user: User = Depends(require_roles("accounts", "admin")), db: AsyncSession = Depends(get_db)):
    p = await _payment_or_404(db, payment_id)
    if p.status == "confirmed":
        return {"ok": True, "receipt_no": p.receipt_no}
    await services.confirm_payment(db, p, user)
    student = await db.get(User, p.user_id)
    await services.notify(db, [p.user_id], "Payment confirmed",
                          f"{services.money(p.amount):,.0f} received. Receipt {p.receipt_no}",
                          "/student/?page=payments", "finance")
    services.queue_event(db, "payment.confirmed", {"receipt_no": p.receipt_no, "amount": services.money(p.amount),
                                                   "method": p.method, "student_id": student.user_id if student else None})
    await audit(db, request, user, "payment.confirm", "payments", p.id)
    await db.commit()
    if student and student.email:
        background.add_task(mailer.send_email, student.email, f"Payment receipt {p.receipt_no}",
                            mailer.layout("Payment Received", f"Thank you, {student.full_name}",
                                          f"<p>We have received your payment of <strong>{services.money(p.amount):,.2f}</strong>"
                                          f" ({html.escape(p.method or '')}).</p>{mailer.id_box('Receipt number', p.receipt_no)}"))
    return {"ok": True, "receipt_no": p.receipt_no}


class RejectIn(BaseModel):
    reason: str | None = Field(None, max_length=500)


@router.post("/api/payments/{payment_id}/reject")
async def reject(payment_id: str, body: RejectIn, request: Request,
                 user: User = Depends(require_roles("accounts", "admin")), db: AsyncSession = Depends(get_db)):
    p = await _payment_or_404(db, payment_id)
    p.status, p.processed_by = "rejected", user.id
    await services.recompute_invoice(db, p.invoice_id)
    await services.notify(db, [p.user_id], "Payment could not be verified",
                          body.reason or "Please contact the accounts office.", "/student/?page=payments", "finance")
    await audit(db, request, user, "payment.reject", "payments", p.id, {"reason": body.reason})
    await db.commit()
    return {"ok": True}


class BulkInvoiceIn(BaseModel):
    class_id: str | None = None
    course: str | None = None
    user_ids: list[str] | None = None
    fee_id: str | None = None
    amount: float | None = Field(None, gt=0)
    description: str = Field(min_length=1, max_length=200)
    due_date: date | None = None


@router.post("/api/invoices/bulk", status_code=201)
async def bulk_invoices(body: BulkInvoiceIn, request: Request,
                        user: User = Depends(require_roles("accounts", "admin")), db: AsyncSession = Depends(get_db)):
    """Bill a whole class, course cohort or list of students in one go (e.g. Term 2 tuition)."""
    amount = body.amount
    if body.fee_id:
        fee = await db.get(Fee, body.fee_id)
        if not fee:
            raise HTTPException(404, "Fee not found.")
        amount = amount or services.money(fee.amount)
    if not amount:
        raise HTTPException(400, "Provide an amount or a fee.")
    stmt = select(User.id).where(User.role == "student", User.status == "active")
    if body.class_id:
        stmt = stmt.where(User.id.in_(select(ClassEnrollment.user_id).where(ClassEnrollment.class_id == body.class_id,
                                                                             ClassEnrollment.status == "active")))
    elif body.course:
        stmt = stmt.where(User.course == body.course)
    elif body.user_ids:
        stmt = stmt.where(User.id.in_(body.user_ids))
    else:
        raise HTTPException(400, "Choose a class, a course or specific students.")
    targets = list((await db.execute(stmt)).scalars())
    if not targets:
        raise HTTPException(400, "No matching active students.")
    first = await services.next_invoice_number(db)
    prefix, n = first.rsplit("-", 1)[0] + "-", int(first.rsplit("-", 1)[1])
    status = services.invoice_status(amount, 0, body.due_date)
    for i, sid in enumerate(targets):
        db.add(Invoice(user_id=sid, fee_id=body.fee_id, description=body.description, amount=amount,
                       due_date=body.due_date, status=status, created_by=user.id,
                       invoice_number=f"{prefix}{n + i:05d}"))
    await services.notify(db, targets, "New invoice", f"{body.description} — {amount:,.0f}",
                          "/student/?page=payments", "finance")
    await audit(db, request, user, "invoice.bulk", "invoices", None, {"count": len(targets), "amount": amount})
    await db.commit()
    return {"ok": True, "created": len(targets)}


@router.get("/api/finance/statement/{student_id}")
async def statement(student_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if user.id != student_id and user.role not in ("accounts", "admin", "superadmin", "director"):
        raise HTTPException(403, "Access denied.")
    student = await db.get(User, student_id)
    if not student:
        raise HTTPException(404, "Student not found.")
    invoices = [dict(r) for r in (await db.execute(
        select(Invoice.id, Invoice.invoice_number, Invoice.description, Invoice.amount, Invoice.discount, Invoice.paid,
               Invoice.due_date, Invoice.status, Invoice.created_at)
        .where(Invoice.user_id == student_id).order_by(Invoice.created_at.desc()))).mappings()]
    payments = [dict(r) for r in (await db.execute(
        select(Payment.id, Payment.receipt_no, Payment.amount, Payment.method, Payment.reference, Payment.status,
               Payment.description, Payment.invoice_id, Payment.proof_url, Payment.created_at)
        .where(Payment.user_id == student_id).order_by(Payment.created_at.desc()))).mappings()]
    billed = sum(services.money(i["amount"]) - services.money(i["discount"]) for i in invoices if i["status"] != "cancelled")
    paid = sum(services.money(p["amount"]) for p in payments if p["status"] == "confirmed")
    return JSONResponse({"student": {"id": student.id, "user_id": student.user_id, "full_name": student.full_name},
                         "invoices": invoices, "payments": payments,
                         "totals": {"billed": billed, "paid": paid, "balance": round(billed - paid, 2)}})


@router.get("/api/finance/summary")
async def finance_summary(user: User = Depends(require_roles(*FINANCE)), db: AsyncSession = Depends(get_db)):
    confirmed = Payment.status == "confirmed"
    total = (await db.execute(select(func.coalesce(func.sum(Payment.amount), 0)).where(confirmed))).scalar_one()
    month_start = date.today().replace(day=1)
    this_month = (await db.execute(select(func.coalesce(func.sum(Payment.amount), 0)).where(
        confirmed, Payment.created_at >= month_start))).scalar_one()
    outstanding = (await db.execute(select(func.coalesce(func.sum(Invoice.amount - Invoice.discount - Invoice.paid), 0))
                                    .where(Invoice.status.in_(("pending", "partial", "overdue"))))).scalar_one()
    overdue = (await db.execute(select(func.count(), func.coalesce(func.sum(Invoice.amount - Invoice.discount - Invoice.paid), 0))
                                .where(Invoice.status == "overdue"))).one()
    pending_payments = (await db.execute(select(func.count()).select_from(Payment)
                                         .where(Payment.status == "pending"))).scalar_one()
    yr, mo = extract("year", Payment.created_at), extract("month", Payment.created_at)
    since = (date.today().replace(day=1) - timedelta(days=335)).replace(day=1)
    monthly = [{"month": f"{int(y)}-{int(m):02d}", "amount": services.money(a)} for y, m, a in (await db.execute(
        select(yr, mo, func.sum(Payment.amount)).where(confirmed, Payment.created_at >= since)
        .group_by(yr, mo).order_by(yr, mo))).all()]
    by_method = [{"method": m or "other", "amount": services.money(a), "count": c} for m, a, c in (await db.execute(
        select(Payment.method, func.sum(Payment.amount), func.count()).where(confirmed).group_by(Payment.method))).all()]
    by_course = [{"course": c or "—", "amount": services.money(a)} for c, a in (await db.execute(
        select(User.course, func.sum(Payment.amount)).join(User, User.id == Payment.user_id)
        .where(confirmed).group_by(User.course).order_by(func.sum(Payment.amount).desc()).limit(12))).all()]
    debtors = [dict(r) for r in (await db.execute(
        select(User.id, User.user_id, User.full_name, User.phone,
               func.sum(Invoice.amount - Invoice.discount - Invoice.paid).label("balance"))
        .join(Invoice, Invoice.user_id == User.id).where(Invoice.status.in_(("pending", "partial", "overdue")))
        .group_by(User.id, User.user_id, User.full_name, User.phone)
        .order_by(func.sum(Invoice.amount - Invoice.discount - Invoice.paid).desc()).limit(15))).mappings()]
    return JSONResponse({"total_revenue": services.money(total), "this_month": services.money(this_month),
                         "outstanding": services.money(outstanding), "overdue_count": overdue[0],
                         "overdue_amount": services.money(overdue[1]), "pending_payments": pending_payments,
                         "monthly": monthly, "by_method": by_method, "by_course": by_course, "top_debtors": debtors})


@router.post("/api/invoices/{invoice_id}/remind")
async def remind(invoice_id: str, request: Request, background: BackgroundTasks,
                 user: User = Depends(require_roles("accounts", "admin")), db: AsyncSession = Depends(get_db)):
    inv = await db.get(Invoice, invoice_id)
    if not inv or inv.status in ("paid", "cancelled"):
        raise HTTPException(400, "This invoice has nothing outstanding.")
    student = await db.get(User, inv.user_id)
    due = services.money(inv.amount) - services.money(inv.discount) - services.money(inv.paid)
    text = f"{inv.invoice_number}: {due:,.0f} outstanding" + (f", due {inv.due_date:%d %b %Y}" if inv.due_date else "")
    await services.notify(db, [inv.user_id], "Payment reminder", text, "/student/?page=payments", "finance")
    inv.reminder_sent_at = services.utcnow()
    await audit(db, request, user, "invoice.remind", "invoices", inv.id)
    await db.commit()
    if student and student.email:
        background.add_task(mailer.send_email, student.email, "Payment reminder — Heimatliebe Institute",
                            mailer.layout("Accounts", f"Dear {student.full_name},",
                                          f"<p>This is a friendly reminder about invoice <strong>{html.escape(text)}</strong>."
                                          " If you have already paid, please upload your proof of payment in the student portal.</p>"))
    return {"ok": True}


async def _printable(db: AsyncSession, title: str, number: str, student: User, rows: list[tuple[str, str]],
                     note: str = "") -> HTMLResponse:
    inst = await services.get_setting(db, "institution")
    trs = "".join(f"<tr><th style='width:40%'>{_esc(k)}</th><td>{_esc(v)}</td></tr>" for k, v in rows)
    return HTMLResponse(f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{_esc(title)} {_esc(number)}</title>{PRINT_CSS}</head><body>
<p class="noprint"><button class="btn" data-print>Print / Save as PDF</button><script src="/js/print.js" defer></script></p>
<div class="head"><div><h1>{_esc(inst['name'])}</h1><div class="muted">{_esc(inst['location'])} · {_esc(inst['phone'])} · {_esc(inst['email'])}</div></div>
<div style="text-align:right"><div style="font-size:1.4rem;color:#1B4332">{_esc(title)}</div><div class="muted">{_esc(number)}</div></div></div>
<h2>Billed to</h2><table><tr><th style='width:40%'>Name</th><td>{_esc(student.full_name)}</td></tr><tr><th>Student ID</th><td>{_esc(student.user_id)}</td></tr>
<tr><th>Course</th><td>{_esc(student.course)}</td></tr></table><h2>Details</h2><table>{trs}</table>
<p class="muted" style="margin-top:32px">{_esc(note)}</p></body></html>""")


@router.get("/api/payments/{payment_id}/receipt", response_class=HTMLResponse)
async def receipt(payment_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    p = await _payment_or_404(db, payment_id)
    if p.user_id != user.id and user.role not in ("accounts", "admin", "superadmin", "director"):
        raise HTTPException(404, "Payment not found.")
    if p.status != "confirmed":
        raise HTTPException(400, "A receipt is available once the payment is confirmed.")
    inst = await services.get_setting(db, "institution")
    inv = await db.get(Invoice, p.invoice_id) if p.invoice_id else None
    return await _printable(db, "Official Receipt", p.receipt_no or p.id, await db.get(User, p.user_id), [
        ("Amount received", f"{inst['currency']} {services.money(p.amount):,.2f}"),
        ("Method", p.method or "—"), ("Reference", p.reference or "—"), ("For", p.description or "—"),
        ("Invoice", inv.invoice_number if inv else "—"),
        ("Date", f"{(p.confirmed_at or p.created_at):%d %B %Y}")], "Thank you for your payment.")


@router.get("/api/invoices/{invoice_id}/print", response_class=HTMLResponse)
async def print_invoice(invoice_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    inv = await db.get(Invoice, invoice_id)
    if not inv or (inv.user_id != user.id and user.role not in ("accounts", "admin", "superadmin", "director")):
        raise HTTPException(404, "Invoice not found.")
    inst = await services.get_setting(db, "institution")
    cur = inst["currency"]
    net = services.money(inv.amount) - services.money(inv.discount)
    return await _printable(db, "Invoice", inv.invoice_number, await db.get(User, inv.user_id), [
        ("Description", inv.description or "—"), ("Amount", f"{cur} {services.money(inv.amount):,.2f}"),
        ("Discount / scholarship", f"{cur} {services.money(inv.discount):,.2f}"),
        ("Paid", f"{cur} {services.money(inv.paid):,.2f}"), ("Balance due", f"{cur} {net - services.money(inv.paid):,.2f}"),
        ("Due date", f"{inv.due_date:%d %B %Y}" if inv.due_date else "—"), ("Status", inv.status)],
        "Pay via Airtel Money, TNM Mpamba or bank transfer and upload your proof of payment in the student portal.")


@router.get("/api/courses/{course_id}/fees")
async def course_fees(course_id: str, db: AsyncSession = Depends(get_db)):
    c = await db.get(Course, course_id)
    if not c:
        raise HTTPException(404, "Course not found.")
    rows = (await db.execute(select(Fee).where(Fee.course_id == course_id))).scalars()
    return JSONResponse([{"id": f.id, "amount": f.amount, "frequency": f.frequency, "type": f.type,
                          "description": f.description} for f in rows])
