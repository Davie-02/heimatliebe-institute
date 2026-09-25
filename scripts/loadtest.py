"""Load test: seed a large school, then hammer the hottest endpoints concurrently.

    python -m scripts.loadtest seed 3000          # add N students (+ invoices, attendance, results)
    python -m scripts.loadtest run http://localhost:8000 200 20
                                  base-url       users concurrency
"""
from __future__ import annotations

import asyncio
import random
import statistics
import sys
import time
from datetime import date, timedelta

import httpx


async def seed(n: int) -> None:
    from sqlalchemy import insert, select

    from app.db import SessionLocal, init_db
    from app.models import Attendance, Class, ClassEnrollment, ExamResult, Exam, Invoice, User, uid
    from app.security import hash_password

    await init_db()
    pw = await hash_password("load12345")
    async with SessionLocal() as db:
        classes = list((await db.execute(select(Class.id))).scalars())
        exam = (await db.execute(select(Exam.id))).scalars().first()
        if not classes:
            sys.exit("Run `python -m app.seed demo` first.")
        users, enrol, inv, att, res = [], [], [], [], []
        for i in range(n):
            u = uid()
            users.append({"id": u, "user_id": f"LOAD-{i:06d}", "full_name": f"Load Student {i}", "role": "student",
                          "status": "active", "password_hash": pw, "email": f"load{i}@test.mw", "course": "German", "level": "A1"})
            c = random.choice(classes)
            enrol.append({"id": uid(), "class_id": c, "user_id": u, "status": "active"})
            inv.append({"id": uid(), "user_id": u, "invoice_number": f"LOAD-INV-{i:06d}", "amount": 200000, "discount": 0,
                        "paid": 0, "status": "pending", "due_date": date.today() + timedelta(days=10)})
            for d in range(20):
                att.append({"id": uid(), "class_id": c, "user_id": u, "date": date.today() - timedelta(days=d * 2),
                            "status": random.choice(["present"] * 8 + ["late", "absent"])})
            if exam:
                pct = random.randint(30, 100)
                res.append({"id": uid(), "exam_id": exam, "user_id": u, "score": pct, "total_points": 100, "percentage": pct,
                            "passed": pct >= 50, "needs_review": False})
        for model, rows in ((User, users), (ClassEnrollment, enrol), (Invoice, inv), (Attendance, att), (ExamResult, res)):
            for k in range(0, len(rows), 2000):
                await db.execute(insert(model), rows[k:k + 2000])
        await db.commit()
    print(f"Seeded {n} students, {len(att)} attendance rows, {len(inv)} invoices, {len(res)} results.")


async def run(base: str, users: int, concurrency: int) -> None:
    lat: dict[str, list[float]] = {}
    errors = 0
    sem = asyncio.Semaphore(concurrency)

    async def hit(c: httpx.AsyncClient, name: str, method: str, path: str, **kw):
        nonlocal errors
        t = time.perf_counter()
        r = await c.request(method, path, **kw)
        lat.setdefault(name, []).append((time.perf_counter() - t) * 1000)
        if r.status_code >= 400:
            errors += 1
        return r

    async def session(i: int):
        async with sem, httpx.AsyncClient(base_url=base, timeout=60) as c:
            await hit(c, "login (bcrypt)", "POST", "/api/login", json={"user_id": f"LOAD-{i:06d}", "password": "load12345"})
            for _ in range(3):
                await hit(c, "student dashboard", "GET", "/api/dashboard/student")
                await hit(c, "unread counts", "GET", "/api/unread")
                await hit(c, "my invoices", "GET", "/api/invoices", params={"order": "created_at.desc"})
                await hit(c, "public courses", "GET", "/api/courses")
                await hit(c, "homepage", "GET", "/")

    async with httpx.AsyncClient(base_url=base, timeout=60) as admin:
        start = time.perf_counter()
        await asyncio.gather(*(session(i) for i in range(users)))
        wall = time.perf_counter() - start
        r = await admin.post("/api/login", json={"user_id": "ADMIN-001", "password": sys.argv[5] if len(sys.argv) > 5 else "admin12345"})
        if r.status_code == 200:
            for _ in range(5):
                await hit(admin, "director KPIs (all students)", "GET", "/api/stats/overview")
                await hit(admin, "finance summary", "GET", "/api/finance/summary")
                await hit(admin, "student list page (50 of N)", "GET", "/api/users", params={"role": "eq.student", "limit": 50, "count": "exact"})
    total = sum(len(v) for v in lat.values())
    print(f"\n{total} requests in {wall:.1f}s (student phase) → {total / wall:.0f} req/s, errors: {errors}\n")
    print(f"{'endpoint':32} {'n':>5} {'p50 ms':>8} {'p95 ms':>8} {'max ms':>8}")
    for k, v in lat.items():
        v.sort()
        print(f"{k:32} {len(v):5d} {statistics.median(v):8.1f} {v[int(len(v) * .95) - 1]:8.1f} {v[-1]:8.1f}")


if __name__ == "__main__":
    if sys.argv[1] == "seed":
        asyncio.run(seed(int(sys.argv[2])))
    else:
        asyncio.run(run(sys.argv[2], int(sys.argv[3]), int(sys.argv[4])))
