"""Integrations, storage signing, site settings and hardening."""
import hashlib
import hmac
from datetime import date, datetime, timezone

import httpx
import pytest

from tests.conftest import login



def test_sigv4_matches_aws_reference_vector():
    # "GET Object" example from the AWS Signature Version 4 documentation.
    from app.storage import sigv4_headers
    headers = sigv4_headers(
        "GET", "https://examplebucket.s3.amazonaws.com/test.txt", {"Range": "bytes=0-9"},
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        access_key="AKIAIOSFODNN7EXAMPLE", secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region="us-east-1", now=datetime(2013, 5, 24, tzinfo=timezone.utc))
    assert headers["authorization"].endswith("Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41")


def test_image_uploads_are_resized_and_converted():
    from io import BytesIO
    from PIL import Image
    from app.storage import optimise_image
    buf = BytesIO()
    Image.new("RGB", (4000, 3000), (30, 120, 60)).save(buf, "PNG")
    data, ext = optimise_image(buf.getvalue(), ".png")
    assert ext == ".webp" and len(data) < len(buf.getvalue())
    assert max(Image.open(BytesIO(data)).size) == 1600


def test_database_url_normalisation(monkeypatch):
    from app import config
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@ep-cool.neon.tech/db?sslmode=require&channel_binding=require")
    url, args = config._database()
    assert url == "postgresql+asyncpg://u:p@ep-cool.neon.tech/db" and args == {"ssl": "require"}
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres")
    _, args = config._database()
    assert args["statement_cache_size"] == 0


def test_production_refuses_unsafe_settings(monkeypatch):
    from app.config import Settings
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(SystemExit):
        Settings().check()


async def test_security_headers(client):
    r = await client.get("/")
    assert "script-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "SAMEORIGIN"


async def test_calendar_feed(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    await client.post("/api/timetable_entries", json={"class_id": school["c1"].id, "day_of_week": 1, "start_time": "17:00", "end_time": "19:00", "room": "R1"})
    await client.post("/api/events", json={"title": "Independence Day", "type": "holiday", "start_date": str(date.today())})
    client.cookies.clear()
    await login(client, "S-1")
    link = (await client.get("/api/calendar/link")).json()
    assert link["google"].startswith("https://calendar.google.com/")
    client.cookies.clear()
    path = "/" + link["url"].split("/", 3)[3]
    ics = await client.get(path)
    assert ics.status_code == 200 and ics.headers["content-type"].startswith("text/calendar")
    assert "RRULE:FREQ=WEEKLY;BYDAY=MO" in ics.text and "Independence Day" in ics.text
    assert (await client.get(path.replace(".ics", "x.ics"))).status_code == 404  # tampered token


async def test_external_apps_visible_by_role(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    await client.post("/api/external_apps", json={"name": "Classroom", "url": "https://classroom.google.com", "audience": "student,teacher"})
    await client.post("/api/external_apps", json={"name": "Finance sheet", "url": "https://docs.google.com/x", "audience": "accounts"})
    client.cookies.clear()
    await login(client, "S-1")
    assert [a["name"] for a in (await client.get("/api/external_apps")).json()] == ["Classroom"]
    assert (await client.post("/api/external_apps", json={"name": "x", "url": "https://x"})).status_code == 403


async def test_webhook_delivery_is_signed(client, school, monkeypatch):
    from app import webhooks
    received = []

    class FakeClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *exc): return False
        async def post(self, url, content=None, headers=None):
            received.append((url, content, headers))
            return httpx.Response(200)

    monkeypatch.setattr(webhooks.httpx, "AsyncClient", FakeClient)
    await login(client, "ADMIN-001", "admin-pass-123")
    hook = (await client.post("/api/webhooks", json={"name": "Zap", "url": "https://hooks.example/abc", "events": "enquiry.new"})).json()[0]
    webhooks.forget_cache()
    await webhooks.dispatch("enquiry.new", {"name": "Lead"})
    await webhooks.dispatch("message", {"private": True})  # never sent out
    assert len(received) == 1
    url, body, headers = received[0]
    expected = "sha256=" + hmac.new(hook["secret"].encode(), body, hashlib.sha256).hexdigest()
    assert url == "https://hooks.example/abc" and headers["X-Heimatliebe-Signature"] == expected
    client.cookies.clear()
    await login(client, "S-1")
    assert (await client.get("/api/webhooks")).status_code == 403


async def test_site_content_settings(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    r = await client.put("/api/settings/site", json={"hero_tagline": "New tagline", "goals": [{"icon": "book", "title": "A", "text": "B"}],
                                                     "hero_words": "not a list", "unknown": 1})
    body = r.json()
    assert body["hero_tagline"] == "New tagline" and len(body["goals"]) == 1
    assert isinstance(body["hero_words"], list) and "unknown" not in body
    client.cookies.clear()
    assert (await client.get("/config.json")).json()["site"]["hero_tagline"] == "New tagline"
    assert (await client.put("/api/settings/site", json={"hero_tagline": "x"})).status_code == 401


async def test_members_only_library_links_hidden_from_public(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    await client.post("/api/library", json={"title": "Free book", "file_url": "/files/library-files/a.pdf", "free": True})
    await client.post("/api/library", json={"title": "Members book", "file_url": "/files/library-files/b.pdf", "free": False})
    client.cookies.clear()
    items = {i["title"]: i["file_url"] for i in (await client.get("/api/library")).json()}
    assert items["Free book"] and items["Members book"] is None
    await login(client, "S-1")
    items = {i["title"]: i["file_url"] for i in (await client.get("/api/library")).json()}
    assert items["Members book"]


async def test_public_file_serving_with_etag(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    url = (await client.post("/api/upload/documents/brochure.pdf", content=b"%PDF-1.4 test")).json()["url"]
    client.cookies.clear()
    r = await client.get(url)
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]
    assert (await client.get(url, headers={"If-None-Match": r.headers["etag"]})).status_code == 304


def test_database_url_mistakes_give_clear_errors(monkeypatch):
    from app import config
    monkeypatch.setenv("DATABASE_URL", "https://abcd.supabase.co")
    with pytest.raises(SystemExit, match="Session pooler"):
        config._database()
    monkeypatch.setenv("DATABASE_URL", "postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")
    with pytest.raises(SystemExit, match="placeholder"):
        config._database()


@pytest.mark.parametrize("password", ["p@ss#word/1?x", "abc:def@", "100%sure", "already%40encoded", "plain123"])
def test_database_passwords_with_special_characters(monkeypatch, password):
    from urllib.parse import unquote
    from sqlalchemy.engine import make_url
    from app import config
    host = "aws-0-eu-central-1.pooler.supabase.com:5432"
    monkeypatch.setenv("DATABASE_URL", f"postgresql://postgres.abcd:{password}@{host}/postgres")
    url, args = config._database()
    parsed = make_url(url)
    assert parsed.host == "aws-0-eu-central-1.pooler.supabase.com" and parsed.port == 5432 and parsed.database == "postgres"
    assert parsed.username == "postgres.abcd" and parsed.password == unquote(password)
    assert args["ssl"] == "require"


def test_unreadable_database_url_hides_password(monkeypatch, capsys):
    from app import config
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:secret-pass@host:notaport/db")
    with pytest.raises(SystemExit) as exc:
        config._database()
    assert "secret-pass" not in str(exc.value)
