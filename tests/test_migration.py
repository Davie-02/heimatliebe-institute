import httpx

from tests.conftest import login


OLD = {
    "users": [{"id": "11111111-1111-1111-1111-111111111111", "user_id": "hmli-2025-1234", "full_name": "Old Student",
               "email": "OLD@x.mw", "role": "student", "status": "active", "course": "German", "level": "A1",
               "password_hash": "$2b$10$abcdefghijklmnopqrstuuJ1Q4b0h2m8m3e1Q5fQn9oS3Vd8Q2", "created_at": "2025-06-01T10:00:00Z"}],
    "courses": [{"id": "22222222-2222-2222-2222-222222222222", "title": "German A1", "fee": "MWK 200,000", "published": True}],
    "news": [{"id": "33333333-3333-3333-3333-333333333333", "title": "Old news", "date": "2025-06-25T10:11:00+02:00"}],
    "applications": [{"id": "44444444-4444-4444-4444-444444444444", "full_name": "Applicant", "email": "a@x.mw",
                      "course": "German", "level": "A1", "password_hash": "$2b$10$x", "status": "pending"}],
    "payments": [{"id": "55555555-5555-5555-5555-555555555555", "student_id": "HMLI-2025-1234", "amount": "150000",
                  "method": "airtel"}],
}


def handler(request: httpx.Request) -> httpx.Response:
    table = request.url.path.rsplit("/", 1)[-1]
    if table not in OLD:
        return httpx.Response(404, json={"message": "relation does not exist"})
    return httpx.Response(200, json=OLD[table] if request.url.params.get("offset") == "0" else [])


async def test_supabase_import(client, monkeypatch):
    from app import migrate_supabase as m
    real = httpx.AsyncClient
    monkeypatch.setattr(m.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setenv("SUPABASE_URL", "https://old.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "k")
    await m.main()
    await m.main()  # re-run is idempotent
    await login(client, "ADMIN-001", "admin-pass-123")
    users = (await client.get("/api/users?user_id=eq.HMLI-2025-1234")).json()
    assert len(users) == 1 and users[0]["email"] == "old@x.mw"
    pays = (await client.get("/api/payments")).json()
    assert len(pays) == 1 and pays[0]["amount"] == 150000 and pays[0]["user_id"] == users[0]["id"]
    assert len((await client.get("/api/applications")).json()) == 1
    assert (await client.get("/api/news")).json()[0]["date"] == "2025-06-25"
