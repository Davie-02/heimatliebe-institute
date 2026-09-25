from datetime import date, datetime, timedelta, timezone


from tests.conftest import PASSWORD, login, make_user, new_client



# ── Security ─────────────────────────────────────────────────────────────
async def test_anonymous_cannot_read_private_tables(client):
    for table in ("users", "payments", "applications", "invoices", "enquiries", "audit_logs"):
        r = await client.get(f"/api/{table}")
        assert r.status_code == 401, table


async def test_password_hash_never_exposed(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    rows = (await client.get("/api/users")).json()
    assert rows and all("password_hash" not in r for r in rows)
    r = await client.get("/api/users?password_hash=like.*")
    assert r.status_code == 400


async def test_login_errors_and_rate_limit(client, school):
    r = await client.post("/api/login", json={"user_id": "S-1", "password": "wrong"})
    assert r.status_code == 401
    for _ in range(6):
        r = await client.post("/api/login", json={"user_id": "S-1", "password": "wrong"})
    assert r.status_code == 429
    # other people behind the same IP (a classroom) can still log in
    assert (await client.post("/api/login", json={"user_id": "S-2", "password": PASSWORD})).status_code == 200


async def test_session_cookie_and_logout(client, school):
    await login(client, "s-1")  # login ID is case-insensitive
    me = (await client.get("/api/me")).json()["user"]
    assert me["user_id"] == "S-1" and me["role"] == "student"
    await client.post("/api/logout")
    client.cookies.clear()
    assert (await client.get("/api/me")).status_code == 401


async def test_password_change_invalidates_old_sessions(school):
    async with new_client() as a, new_client() as b:
        await login(a, "S-1")
        await login(b, "S-1")
        r = await a.post("/api/change-password", json={"old_password": PASSWORD, "new_password": "brand-new-pw"})
        assert r.status_code == 200
        assert (await a.get("/api/me")).status_code == 200  # the tab that changed it stays signed in
        from app import security
        security._user_cache.clear()
        assert (await b.get("/api/me")).status_code == 401


async def test_cross_site_write_blocked(client, school):
    r = await client.post("/api/login", json={"user_id": "S-1", "password": PASSWORD},
                          headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


async def test_student_row_level_security(client, school):
    await login(client, "ACC-1")
    for s in ("s1", "s3"):
        r = await client.post("/api/invoices", json={"user_id": school[s].id, "amount": 1000, "description": "Tuition"})
        assert r.status_code == 201, r.text
    client.cookies.clear()
    await login(client, "S-1")
    inv = (await client.get("/api/invoices")).json()
    assert len(inv) == 1 and inv[0]["user_id"] == school["s1"].id
    # a student cannot record a confirmed payment for themselves through the data API
    r = await client.post("/api/payments", json={"user_id": school["s1"].id, "amount": 1000, "status": "confirmed"})
    assert r.status_code == 403
    # users visible to a student: self, classmates and staff only, with limited columns
    users = (await client.get("/api/users")).json()
    ids = {u["id"] for u in users}
    assert school["s2"].id in ids and school["s3"].id not in ids
    assert all("email" not in u for u in users)


async def test_teacher_can_only_manage_own_classes(client, school):
    await login(client, "T-1")
    ok = await client.post("/api/assignments", json={"title": "Essay", "class_id": school["c1"].id})
    assert ok.status_code == 201
    bad = await client.post("/api/assignments", json={"title": "Hack", "class_id": school["c2"].id})
    assert bad.status_code == 403
    classes = (await client.get("/api/classes")).json()
    assert {c["id"] for c in classes} >= {school["c1"].id}
    moved = await client.patch(f"/api/assignments/{ok.json()[0]['id']}", json={"class_id": school["c2"].id})
    assert moved.status_code == 403


# ── Query language ───────────────────────────────────────────────────────
async def test_filters_order_count_and_expand(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    r = await client.get("/api/users?role=eq.student&order=user_id.desc&count=exact&limit=2")
    assert r.status_code == 200 and r.headers["X-Total-Count"] == "3"
    assert [u["user_id"] for u in r.json()] == ["S-3", "S-2"]
    r = await client.get("/api/users?or=(user_id.eq.S-1,user_id.eq.T-1)&select=id,user_id")
    assert sorted(u["user_id"] for u in r.json()) == ["S-1", "T-1"]
    r = await client.get(f"/api/users?id=in.({school['s1'].id},{school['s2'].id})")
    assert len(r.json()) == 2
    r = await client.get("/api/users?full_name=ilike.*three*")
    assert [u["user_id"] for u in r.json()] == ["S-3"]
    r = await client.get("/api/users?q=teacher")
    assert len(r.json()) == 2
    r = await client.get("/api/class_enrollments?expand=user,class")
    row = r.json()[0]
    assert row["user"]["full_name"] and row["class"]["name"]
    assert (await client.get("/api/users?nope=eq.1")).status_code == 400


async def test_public_content_hides_unpublished(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    await client.post("/api/news", json={"title": "Draft", "published": False})
    await client.post("/api/news", json={"title": "Live", "published": True, "date": "2026-01-02"})
    client.cookies.clear()
    titles = [n["title"] for n in (await client.get("/api/news")).json()]
    assert "Live" in titles and "Draft" not in titles
    assert (await client.post("/api/news", json={"title": "anon"})).status_code == 401


# ── Admissions ───────────────────────────────────────────────────────────
async def test_application_to_student_flow(client, school):
    r = await client.post("/api/upload/payment-proofs/proof.png", content=b"\x89PNG fake")
    assert r.status_code == 200
    proof = r.json()["url"]
    assert proof.startswith("/api/files/payment-proofs/")
    body = {"full_name": "New Applicant", "email": "NEW@Example.com", "phone": "+265999000000", "course": "German",
            "level": "A1", "password": "applicant-pw", "payment_proof_url": proof}
    r = await client.post("/api/submit-application", json=body)
    assert r.status_code == 201, r.text
    ref = r.json()["reference"]
    assert (await client.post("/api/submit-application", json=body)).status_code == 409  # duplicate open app
    st = (await client.post("/api/application-status", json={"reference": ref, "email": "new@example.com"})).json()
    assert st["status"] == "pending"
    # proof is private
    assert (await client.get(proof)).status_code == 401

    await login(client, "ADMIN-001", "admin-pass-123")
    assert (await client.get(proof)).status_code == 200
    app_id = (await client.get(f"/api/applications?reference=eq.{ref}")).json()[0]["id"]
    r = await client.post(f"/api/applications/{app_id}/approve",
                          json={"class_id": school["c1"].id, "invoice_amount": 50000})
    assert r.status_code == 200, r.text
    sid = r.json()["student_id"]
    assert r.json()["enrolment"]["status"] == "waitlisted"  # class c1 is full (max 2)
    client.cookies.clear()
    user = await login(client, sid, "applicant-pw")
    assert user["role"] == "student" and user["course"] == "German"
    stmt = (await client.get(f"/api/finance/statement/{user['id']}")).json()
    assert stmt["totals"]["balance"] == 50000


async def test_enquiry_and_placement(client):
    r = await client.post("/api/contact-enquiry", json={"name": "Lead", "phone": "+265888", "interest": "German"})
    assert r.status_code == 200
    qs = (await client.get("/api/placement/German")).json()["questions"]
    assert qs and "answer" not in qs[0]
    r = await client.post("/api/placement/German", json={"full_name": "Tester", "answers": {}})
    assert r.json()["recommended_level"] == "A1"
    from app import placement_bank as pb
    perfect = {str(i): pb._order("German", i, 4).index(0) for i in range(len(qs))}
    r = await client.post("/api/placement/German", json={"full_name": "Pro", "answers": perfect})
    assert r.json()["recommended_level"] == "C2"


# ── Academics ────────────────────────────────────────────────────────────
async def test_exam_hides_answers_and_autogrades(client, school):
    await login(client, "T-1")
    exam = {"title": "Quiz", "class_id": school["c1"].id, "published": True, "pass_mark": 50,
            "date": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
            "questions": [{"text": "2+2", "type": "mcq", "options": ["3", "4"], "answer": 1},
                          {"text": "Hallo in English", "type": "text", "answer": ["hello"], "points": 2}]}
    exam_id = (await client.post("/api/exams", json=exam)).json()[0]["id"]
    client.cookies.clear()
    await login(client, "S-1")
    seen = (await client.get(f"/api/exams/{exam_id}")).json()
    assert all("answer" not in q for q in seen["questions"])
    r = await client.post(f"/api/exams/{exam_id}/submit", json={"answers": {"0": 1, "1": " Hello "}})
    assert r.json() == {"ok": True, "score": 3.0, "total_points": 3.0, "percentage": 100.0,
                        "needs_review": False, "passed": True}
    assert (await client.post(f"/api/exams/{exam_id}/submit", json={"answers": {}})).status_code == 409
    client.cookies.clear()
    await login(client, "S-3")  # not in the class
    assert (await client.post(f"/api/exams/{exam_id}/submit", json={"answers": {}})).status_code in (403, 404)


async def test_attendance_bulk_and_report(client, school):
    await login(client, "T-1")
    body = {"class_id": school["c1"].id, "date": str(date.today()),
            "records": [{"user_id": school["s1"].id, "status": "present"},
                        {"user_id": school["s2"].id, "status": "absent"},
                        {"user_id": school["s3"].id, "status": "present"}]}  # s3 not enrolled → ignored
    assert (await client.post("/api/attendance/bulk", json=body)).status_code == 200
    body["records"][1]["status"] = "late"  # re-saving the same day updates instead of duplicating
    assert (await client.post("/api/attendance/bulk", json=body)).status_code == 200
    roster = (await client.get(f"/api/classes/{school['c1'].id}/roster")).json()
    rates = {s["user_id"]: s["attendance"]["rate"] for s in roster["students"]}
    assert rates == {"S-1": 100.0, "S-2": 100.0}
    gb = await client.get(f"/api/classes/{school['c1'].id}/gradebook")
    assert gb.status_code == 200
    assert (await client.get(f"/api/classes/{school['c2'].id}/gradebook")).status_code == 403
    r = await client.get(f"/api/students/{school['s1'].id}/report.html")
    assert r.status_code == 200 and "Student One" in r.text
    assert (await client.get(f"/api/students/{school['s3'].id}/report")).status_code == 403


async def test_submission_and_grading(client, school):
    await login(client, "T-1")
    aid = (await client.post("/api/assignments", json={"title": "Essay", "class_id": school["c1"].id,
                                                       "total_points": 20})).json()[0]["id"]
    client.cookies.clear()
    await login(client, "S-1")
    r = await client.post("/api/submissions", json={"assignment_id": aid, "content": "Mein Aufsatz", "grade": 20})
    assert r.status_code == 201 and r.json()[0]["grade"] is None  # students can't grade themselves
    sub_id = r.json()[0]["id"]
    client.cookies.clear()
    await login(client, "S-3")
    assert (await client.post("/api/submissions", json={"assignment_id": aid, "content": "x"})).status_code == 403
    client.cookies.clear()
    await login(client, "T-1")
    r = await client.patch(f"/api/submissions/{sub_id}", json={"grade": 17, "feedback": "Gut!"})
    assert r.status_code == 200 and r.json()[0]["grade"] == 17
    client.cookies.clear()
    await login(client, "S-1")
    notes = (await client.get("/api/notifications")).json()
    assert any(n["title"] == "Assignment graded" for n in notes)
    dash = (await client.get("/api/dashboard/student")).json()
    assert dash["unread"]["notifications"] >= 1


async def test_enroll_waitlist_promotion(client, school):
    s4 = await make_user("student", "S-4")
    await login(client, "ADMIN-001", "admin-pass-123")
    r = (await client.post(f"/api/classes/{school['c1'].id}/enroll", json={"user_ids": [s4.id]})).json()
    assert r == {"ok": True, "enrolled": 0, "waitlisted": 1}
    r = (await client.post(f"/api/classes/{school['c1'].id}/unenroll/{school['s1'].id}")).json()
    assert r["promoted_from_waitlist"] == s4.id


async def test_certificate_issue_and_verify(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    r = await client.post("/api/certificates/issue", json={"user_id": school["s1"].id, "course": "German", "level": "A1"})
    assert r.status_code == 201
    code = r.json()["verification_code"]
    client.cookies.clear()
    v = (await client.get(f"/api/verify-certificate/{code}")).json()
    assert v["valid"] and v["full_name"] == "Student One"
    assert (await client.get("/api/verify-certificate/NOPE")).json() == {"valid": False}


# ── Finance ──────────────────────────────────────────────────────────────
async def test_payment_submission_confirmation_and_invoice_status(client, school):
    await login(client, "ACC-1")
    inv = (await client.post("/api/invoices", json={"user_id": school["s1"].id, "amount": 1000,
                                                    "description": "Term 1"})).json()[0]
    assert inv["invoice_number"].startswith("INV-") and inv["status"] == "pending"
    client.cookies.clear()
    await login(client, "S-1")
    pid = (await client.post("/api/payments/submit", json={"invoice_id": inv["id"], "amount": 400,
                                                           "method": "airtel", "reference": "AM123"})).json()["id"]
    client.cookies.clear()
    await login(client, "ACC-1")
    r = (await client.post(f"/api/payments/{pid}/confirm")).json()
    assert r["receipt_no"].startswith("RCT-")
    inv2 = (await client.get(f"/api/invoices/{inv['id']}")).json()
    assert inv2["paid"] == 400 and inv2["status"] == "partial"
    await client.post("/api/payments", json={"user_id": school["s1"].id, "invoice_id": inv["id"], "amount": 600,
                                             "method": "cash"})
    assert (await client.get(f"/api/invoices/{inv['id']}")).json()["status"] == "paid"
    summary = (await client.get("/api/finance/summary")).json()
    assert summary["total_revenue"] == 1000
    r = await client.get(f"/api/payments/{pid}/receipt")
    assert r.status_code == 200 and "Official Receipt" in r.text


async def test_bulk_invoices_and_csv(client, school):
    await login(client, "ACC-1")
    r = await client.post("/api/invoices/bulk", json={"class_id": school["c1"].id, "amount": 5000,
                                                      "description": "Materials", "due_date": str(date.today())})
    assert r.json()["created"] == 2
    csv = await client.get("/api/reports/invoices.csv")
    assert csv.status_code == 200 and csv.text.count("Materials") == 2
    assert (await client.get("/api/reports/staff.csv")).status_code == 403


# ── HR / messaging ───────────────────────────────────────────────────────
async def test_hr_creates_users(client, school):
    await login(client, "HR-1")
    r = await client.post("/api/users", json={"full_name": "New Teacher", "role": "teacher", "email": "nt@x.mw"})
    assert r.status_code == 201 and r.json()["user"]["user_id"].startswith("HMLI-STF-")
    tmp = r.json()["temporary_password"]
    assert (await client.post("/api/users", json={"full_name": "Sneaky", "role": "admin"})).status_code == 403
    async with new_client() as c2:
        u = await login(c2, r.json()["user"]["user_id"], tmp)
        assert u["must_change_password"] is True


async def test_messaging_between_student_and_teacher(school):
    async with new_client() as st, new_client() as te:
        await login(st, "S-1")
        await login(te, "T-1")
        r = await st.post("/api/conversations", json={"recipient": "T-1", "subject": "Frage", "body": "Hallo!"})
        assert r.status_code == 201
        conv = r.json()["id"]
        inbox = (await te.get("/api/inbox")).json()
        assert inbox[0]["unread"] and inbox[0]["with"] == ["Student One"]
        assert (await te.get("/api/unread")).json()["messages"] == 1
        await te.get(f"/api/conversations/{conv}/messages")
        assert (await te.get("/api/unread")).json()["messages"] == 0
        await te.post(f"/api/conversations/{conv}/messages", json={"body": "Hallo zurück"})
        msgs = (await st.get(f"/api/conversations/{conv}/messages")).json()["messages"]
        assert [m["body"] for m in msgs] == ["Hallo!", "Hallo zurück"]
        # a student cannot message a student outside their classes
        r = await st.post("/api/conversations", json={"recipient": "S-3", "body": "hi"})
        assert r.status_code == 404


async def test_upload_permissions(client, school):
    assert (await client.post("/api/upload/gallery/a.png", content=b"x")).status_code == 401
    assert (await client.post("/api/upload/payment-proofs/a.exe", content=b"x")).status_code == 400
    await login(client, "S-1")
    assert (await client.post("/api/upload/gallery/a.png", content=b"x")).status_code == 403
    r = await client.post("/api/upload/submissions/essay.pdf", content=b"%PDF")
    url = r.json()["url"]
    assert (await client.get(url)).status_code == 200  # owner
    client.cookies.clear()
    await login(client, "S-2")
    assert (await client.get(url)).status_code == 404  # other student


async def test_stats_and_settings(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    s = (await client.get("/api/stats/overview")).json()
    assert s["students"] == 3 and s["teachers"] == 2
    r = await client.put("/api/settings/institution", json={"current_term": "Term 2", "secret": "x"})
    assert r.json()["current_term"] == "Term 2" and "secret" not in r.json()
    client.cookies.clear()
    assert (await client.get("/config.json")).json()["institution"]["current_term"] == "Term 2"


async def test_scheduler_cycle_runs(school):
    from app.tasks import run_cycle
    stats = await run_cycle()
    assert "overdue_marked" in stats


# ── Regressions found during browser testing ─────────────────────────────
async def test_boolean_filters(client, school):
    await login(client, "ADMIN-001", "admin-pass-123")
    await client.post("/api/scholarships", json={"title": "Open one", "open": True})
    await client.post("/api/scholarships", json={"title": "Closed one", "open": False})
    r = await client.get("/api/scholarships?open=eq.true")
    assert r.status_code == 200 and [x["title"] for x in r.json()] == ["Open one"]
    assert len((await client.get("/api/scholarships?open=is.false")).json()) == 1


async def test_unlinked_payment_settles_oldest_invoice(client, school):
    await login(client, "ACC-1")
    inv = (await client.post("/api/invoices", json={"user_id": school["s1"].id, "amount": 500,
                                                    "description": "Tuition", "due_date": "2030-01-01"})).json()[0]
    client.cookies.clear()
    await login(client, "S-1")
    pid = (await client.post("/api/payments/submit", json={"amount": 500, "method": "tnm"})).json()["id"]
    client.cookies.clear()
    await login(client, "ACC-1")
    await client.post(f"/api/payments/{pid}/confirm")
    assert (await client.get(f"/api/invoices/{inv['id']}")).json()["status"] == "paid"


async def test_static_security(client):
    for path in ("/config.example.json", "/app/main.py", "/.env", "/var/heimatliebe.db", "/README.md"):
        assert (await client.get(path)).status_code == 404, path
    r = await client.get("/js/api.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"
