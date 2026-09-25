import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="hmli-test-")
os.environ["HMLI_VAR_DIR"] = _tmp
os.environ["DATABASE_URL"] = ""
os.environ["APP_ENV"] = "development"
os.environ["RUN_SCHEDULER"] = "false"
os.environ["ADMIN_PASSWORD"] = "admin-pass-123"
os.environ["SMTP_USER"] = ""

import httpx  # noqa: E402
import pytest_asyncio  # noqa: E402

from app import security  # noqa: E402
from app.db import SessionLocal, engine, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Class, ClassEnrollment, User  # noqa: E402
from app.seed import bootstrap  # noqa: E402

PASSWORD = "password123"


@pytest_asyncio.fixture(autouse=True)
async def fresh_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await init_db()
    await bootstrap()
    security.reset_rate_limits()
    security._user_cache.clear()
    from app import services
    services.public_cache_clear()
    services._settings_cache.clear()
    yield


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def make_user(role: str, user_id: str, name: str | None = None, **kw) -> User:
    async with SessionLocal() as db:
        u = User(user_id=user_id, full_name=name or user_id, role=role, status="active",
                 email=f"{user_id.lower()}@test.mw", password_hash=await security.hash_password(PASSWORD), **kw)
        db.add(u)
        await db.commit()
        return u


async def login(c: httpx.AsyncClient, user_id: str, password: str = PASSWORD) -> dict:
    r = await c.post("/api/login", json={"user_id": user_id, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["user"]


def new_client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def school():
    """Two teachers, three students, a class for teacher 1 (students 1+2) and one for teacher 2 (student 3)."""
    t1 = await make_user("teacher", "T-1", "Teacher One")
    t2 = await make_user("teacher", "T-2", "Teacher Two")
    s1 = await make_user("student", "S-1", "Student One", course="German", level="A1")
    s2 = await make_user("student", "S-2", "Student Two", course="German", level="A1")
    s3 = await make_user("student", "S-3", "Student Three", course="French", level="A1")
    acc = await make_user("accounts", "ACC-1", "Accountant")
    hr = await make_user("hr", "HR-1", "HR Officer")
    async with SessionLocal() as db:
        c1 = Class(name="German A1", teacher_id=t1.id, max_students=2)
        c2 = Class(name="French A1", teacher_id=t2.id)
        db.add_all([c1, c2])
        await db.flush()
        db.add_all([ClassEnrollment(class_id=c1.id, user_id=s1.id), ClassEnrollment(class_id=c1.id, user_id=s2.id),
                    ClassEnrollment(class_id=c2.id, user_id=s3.id)])
        await db.commit()
    return {"t1": t1, "t2": t2, "s1": s1, "s2": s2, "s3": s3, "acc": acc, "hr": hr, "c1": c1, "c2": c2}
