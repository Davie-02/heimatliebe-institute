"""One-time import from the old Supabase-backed site into the new database.

    SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=... DATABASE_URL=postgresql://... \
        python -m app.migrate_supabase

Safe to re-run: rows whose id already exists are skipped. Existing bcrypt password hashes are
kept, so users log in with their current passwords. Old SHA-256 hashes are upgraded on first login.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import date, datetime

import httpx
from sqlalchemy import insert, select

from .db import SessionLocal, init_db
from .models import Base, uid
from .services import application_reference

T = Base.metadata.tables
SIMPLE = ["courses", "library", "news", "gallery", "documents", "testimonials", "scholarships", "alumni"]


async def fetch_all(client: httpx.AsyncClient, table: str) -> list[dict]:
    rows, offset = [], 0
    while True:
        r = await client.get(f"/rest/v1/{table}", params={"select": "*", "offset": offset, "limit": 1000})
        if r.status_code == 404 or r.status_code == 400:
            return rows  # table doesn't exist in the old project
        r.raise_for_status()
        batch = r.json()
        rows += batch
        if len(batch) < 1000:
            return rows
        offset += 1000


def clean(table: str, row: dict) -> dict:
    t = T[table]
    out = {}
    for c in t.columns:
        if c.name not in row or row[c.name] is None:
            continue
        v = row[c.name]
        try:
            py = c.type.python_type
        except NotImplementedError:
            py = None
        if py is datetime and isinstance(v, str):
            v = datetime.fromisoformat(v.replace("Z", "+00:00"))
        elif py is date and isinstance(v, str):
            v = date.fromisoformat(v[:10])
        elif py in (int, float) and isinstance(v, str):
            try:
                v = py(v)
            except ValueError:
                continue
        out[c.name] = v
    return out


async def main() -> None:
    url, key = os.environ.get("SUPABASE_URL", "").rstrip("/"), os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (service role key) of the OLD project.")
    await init_db()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    async with httpx.AsyncClient(base_url=url, headers=headers, timeout=60) as client, SessionLocal() as db:
        async def existing(table):
            return set((await db.execute(select(T[table].c.id))).scalars())

        # Users first (everything else references them)
        users = await fetch_all(client, "users")
        have = await existing("users")
        by_login = {}
        n = 0
        for u in users:
            row = clean("users", u)
            row.setdefault("id", uid())
            row["user_id"] = (row.get("user_id") or row["id"][:8]).upper()
            if row.get("email"):
                row["email"] = row["email"].lower()
            row.setdefault("password_hash", "!")  # unusable until reset
            by_login[row["user_id"]] = row["id"]
            if row["id"] not in have:
                await db.execute(insert(T["users"]).values(**row)); n += 1
        print(f"users: {n} imported ({len(users)} found)")

        for table in SIMPLE:
            rows = await fetch_all(client, table)
            have = await existing(table)
            n = 0
            for r in rows:
                row = clean(table, r)
                if table == "gallery" and not row.get("src"):
                    continue
                row.setdefault("id", uid())
                if row["id"] not in have:
                    await db.execute(insert(T[table]).values(**row)); n += 1
            print(f"{table}: {n} imported ({len(rows)} found)")

        apps = await fetch_all(client, "applications")
        have = await existing("applications")
        n = 0
        for a in apps:
            row = clean("applications", a)
            row.setdefault("id", uid())
            row.setdefault("reference", application_reference())
            row.setdefault("password_hash", "!")
            if row["id"] not in have:
                await db.execute(insert(T["applications"]).values(**row)); n += 1
        print(f"applications: {n} imported ({len(apps)} found)")

        pays = await fetch_all(client, "payments")
        have = await existing("payments")
        n = skipped = 0
        for p in pays:
            row = clean("payments", p)
            owner = p.get("user_id") or by_login.get(str(p.get("student_id") or "").upper())
            if not owner:
                skipped += 1
                continue
            row["user_id"] = owner
            row.setdefault("id", uid())
            row.setdefault("status", "confirmed")
            if row["id"] not in have:
                await db.execute(insert(T["payments"]).values(**row)); n += 1
        print(f"payments: {n} imported, {skipped} skipped (no matching student)")
        await db.commit()
    print("Done. Review the data in the admin portal, then point the domain at the new app.")


if __name__ == "__main__":
    asyncio.run(main())
