"""Internal messaging (realtime), notifications and the recipient directory."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import services
from ..db import get_db
from ..models import (
    Class, ClassEnrollment, Conversation, ConversationParticipant, Message, Notification, User,
)
from ..responses import JSONResponse
from ..security import STAFF_ROLES, audit, current_user, require_staff

router = APIRouter(tags=["messaging"])


async def _allowed_recipient(db: AsyncSession, sender: User, recipient: User) -> bool:
    if recipient.id == sender.id or recipient.status != "active":
        return False
    if sender.role in STAFF_ROLES:
        return True
    # Students may message any staff member; student-to-student is limited to classmates.
    if recipient.role in STAFF_ROLES:
        return True
    mine = select(ClassEnrollment.class_id).where(ClassEnrollment.user_id == sender.id)
    shared = (await db.execute(select(func.count()).select_from(ClassEnrollment).where(
        ClassEnrollment.user_id == recipient.id, ClassEnrollment.class_id.in_(mine)))).scalar_one()
    return shared > 0


@router.get("/api/directory")
async def directory(q: str = "", user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """People the current user can message, searchable by name / ID."""
    stmt = select(User.id, User.user_id, User.full_name, User.role, User.department, User.course) \
        .where(User.status == "active", User.id != user.id)
    if user.role == "student":
        mine = select(ClassEnrollment.class_id).where(ClassEnrollment.user_id == user.id)
        classmates = select(ClassEnrollment.user_id).where(ClassEnrollment.class_id.in_(mine))
        stmt = stmt.where(or_(User.role != "student", User.id.in_(classmates)))
    if q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(term), User.user_id.ilike(term), User.email.ilike(term)))
    rows = (await db.execute(stmt.order_by(User.role != "teacher", User.full_name).limit(50))).mappings()
    return JSONResponse([dict(r) for r in rows])


@router.get("/api/inbox")
async def inbox(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    me = select(ConversationParticipant.conversation_id, ConversationParticipant.last_read_at) \
        .where(ConversationParticipant.user_id == user.id).subquery()
    convs = (await db.execute(
        select(Conversation.id, Conversation.subject, Conversation.updated_at, me.c.last_read_at)
        .join(me, me.c.conversation_id == Conversation.id).order_by(Conversation.updated_at.desc()).limit(200)
    )).mappings().all()
    ids = [c["id"] for c in convs] or [""]
    people: dict[str, list[str]] = {}
    for cid, name in (await db.execute(
            select(ConversationParticipant.conversation_id, User.full_name)
            .join(User, User.id == ConversationParticipant.user_id)
            .where(ConversationParticipant.conversation_id.in_(ids), User.id != user.id))).all():
        people.setdefault(cid, []).append(name)
    last_ts = select(Message.conversation_id, func.max(Message.created_at).label("ts")) \
        .where(Message.conversation_id.in_(ids)).group_by(Message.conversation_id).subquery()
    last = {r.conversation_id: r for r in (await db.execute(
        select(Message.conversation_id, Message.body, Message.sender_id, Message.created_at)
        .join(last_ts, and_(last_ts.c.conversation_id == Message.conversation_id,
                            last_ts.c.ts == Message.created_at)))).all()}
    out = []
    for c in convs:
        lm = last.get(c["id"])
        lr = c["last_read_at"]
        unread = bool(lm and lm.sender_id != user.id and (lr is None or lm.created_at > lr))
        out.append({"id": c["id"], "subject": c["subject"], "updated_at": c["updated_at"],
                    "with": people.get(c["id"], []), "last_message": lm.body[:140] if lm else "",
                    "last_from_me": bool(lm and lm.sender_id == user.id), "unread": unread})
    return JSONResponse(out)


class NewConversationIn(BaseModel):
    recipient: str = Field(min_length=1, max_length=254, description="user id, login ID or email")
    subject: str | None = Field(None, max_length=200)
    body: str = Field(min_length=1, max_length=10000)


@router.post("/api/conversations", status_code=201)
async def start_conversation(body: NewConversationIn, request: Request, user: User = Depends(current_user),
                             db: AsyncSession = Depends(get_db)):
    r = body.recipient.strip()
    recipient = (await db.execute(select(User).where(or_(User.id == r, User.user_id == r.upper(),
                                                         User.email == r.lower())).limit(1))).scalar_one_or_none()
    if not recipient or not await _allowed_recipient(db, user, recipient):
        raise HTTPException(404, "Recipient not found or not available for messaging.")
    now = services.utcnow()
    conv = Conversation(subject=body.subject or "(No subject)", created_by=user.id, updated_at=now)
    db.add(conv)
    await db.flush()
    db.add_all([ConversationParticipant(conversation_id=conv.id, user_id=user.id, last_read_at=now),
                ConversationParticipant(conversation_id=conv.id, user_id=recipient.id)])
    db.add(Message(conversation_id=conv.id, sender_id=user.id, body=body.body, created_at=now))
    services.queue_event(db, "message", {"conversation_id": conv.id, "from": user.full_name,
                                         "subject": conv.subject, "body": body.body[:140]}, users=[recipient.id])
    await db.commit()
    return {"ok": True, "id": conv.id}


async def _membership(db: AsyncSession, conv_id: str, user: User) -> ConversationParticipant | None:
    return (await db.execute(select(ConversationParticipant).where(
        ConversationParticipant.conversation_id == conv_id, ConversationParticipant.user_id == user.id))).scalar_one_or_none()


@router.get("/api/conversations/{conv_id}/messages")
async def conversation_messages(conv_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    member = await _membership(db, conv_id, user)
    if not member and user.role not in ("admin", "superadmin"):
        raise HTTPException(404, "Conversation not found.")
    conv = await db.get(Conversation, conv_id)
    rows = (await db.execute(
        select(Message.id, Message.body, Message.created_at, Message.sender_id, User.full_name.label("sender_name"),
               User.role.label("sender_role"))
        .outerjoin(User, User.id == Message.sender_id).where(Message.conversation_id == conv_id)
        .order_by(Message.created_at).limit(500))).mappings()
    participants = [dict(r) for r in (await db.execute(
        select(User.id, User.full_name, User.role).join(ConversationParticipant, ConversationParticipant.user_id == User.id)
        .where(ConversationParticipant.conversation_id == conv_id))).mappings()]
    if member:
        member.last_read_at = services.utcnow()
        await db.commit()
    return JSONResponse({"id": conv_id, "subject": conv.subject if conv else "", "participants": participants,
                         "messages": [dict(r) for r in rows]})


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


@router.post("/api/conversations/{conv_id}/messages", status_code=201)
async def reply(conv_id: str, body: ReplyIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    member = await _membership(db, conv_id, user)
    if not member:
        raise HTTPException(404, "Conversation not found.")
    now = services.utcnow()
    msg = Message(conversation_id=conv_id, sender_id=user.id, body=body.body, created_at=now)
    db.add(msg)
    member.last_read_at = now
    await db.execute(update(Conversation).where(Conversation.id == conv_id).values(updated_at=now))
    others = list((await db.execute(select(ConversationParticipant.user_id).where(
        ConversationParticipant.conversation_id == conv_id, ConversationParticipant.user_id != user.id))).scalars())
    services.queue_event(db, "message", {"conversation_id": conv_id, "from": user.full_name,
                                         "body": body.body[:140]}, users=others)
    await db.commit()
    return {"ok": True, "id": msg.id, "created_at": now}


# ── Notifications ────────────────────────────────────────────────────────
@router.post("/api/notifications/mark-all-read")
async def mark_all_read(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Notification).where(Notification.user_id == user.id, Notification.read.is_(False))
                     .values(read=True))
    await db.commit()
    return {"ok": True}


class SendNotificationIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str | None = Field(None, max_length=4000)
    link: str | None = Field(None, max_length=500)
    user_ids: list[str] | None = None
    recipient: str | None = Field(None, max_length=254, description="login ID or email of one person")
    class_id: str | None = None
    role: str | None = Field(None, pattern="^(student|teacher|accounts|hr|director|admin|all)$")


@router.post("/api/notifications/send")
async def send_notification(body: SendNotificationIn, request: Request, user: User = Depends(require_staff),
                            db: AsyncSession = Depends(get_db)):
    targets: list[str] = []
    if body.class_id:
        cls = await db.get(Class, body.class_id)
        if not cls:
            raise HTTPException(404, "Class not found.")
        if user.role == "teacher" and cls.teacher_id != user.id:
            raise HTTPException(403, "You can only notify your own classes.")
        targets = await services.class_student_ids(db, cls.id)
    elif body.recipient:
        r = body.recipient.strip()
        u = (await db.execute(select(User.id).where(or_(User.user_id == r.upper(), User.email == r.lower())))).scalar_one_or_none()
        if not u:
            raise HTTPException(404, "User not found.")
        targets = [u]
    elif body.user_ids:
        targets = body.user_ids
    elif body.role:
        if user.role not in ("admin", "superadmin", "director", "hr"):
            raise HTTPException(403, "Only management can broadcast to a whole role.")
        stmt = select(User.id).where(User.status == "active")
        if body.role != "all":
            stmt = stmt.where(User.role == body.role)
        targets = list((await db.execute(stmt)).scalars())
    elif user.role == "teacher":  # default for teachers: all students in all their classes
        mine = select(Class.id).where(Class.teacher_id == user.id)
        targets = list((await db.execute(select(ClassEnrollment.user_id).where(
            ClassEnrollment.class_id.in_(mine)).distinct())).scalars())
    if user.role == "teacher" and body.user_ids:
        allowed = set((await db.execute(select(ClassEnrollment.user_id).where(
            ClassEnrollment.class_id.in_(select(Class.id).where(Class.teacher_id == user.id))))).scalars())
        targets = [t for t in targets if t in allowed]
    if not targets:
        raise HTTPException(400, "No recipients matched.")
    await services.notify(db, targets, body.title, body.body or "", body.link, "announcement")
    await audit(db, request, user, "notification.send", "notifications", None, {"count": len(targets)})
    await db.commit()
    return {"ok": True, "sent": len(set(targets))}
