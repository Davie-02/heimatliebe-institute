"""Heimatliebe Institute platform — application entry point.

Run locally:   uvicorn app.main:app --reload
Production:    uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'

Request flow: security middleware → API routers (specific first, generic data API last) → static site.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from . import rest
from .config import PUBLIC_DIR, settings
from .db import engine, init_db
from .realtime import hub
from .responses import JSONResponse
from .routers import academics, admin, auth, finance, integrations, messaging, public, system
from .seed import bootstrap, seed_demo
from .tasks import scheduler_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("hmli")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.check()
    await init_db()
    await bootstrap()
    if settings.app_env == "staging" and settings.is_sqlite:
        await seed_demo()  # staging without a database gets fresh demo data on every start
    await hub.start()
    task = asyncio.create_task(scheduler_loop()) if settings.run_scheduler else None
    log.info("Heimatliebe platform ready (%s, %s)", settings.app_env, settings.database_url.split(":", 1)[0])
    yield
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    await hub.stop()
    await engine.dispose()


app = FastAPI(title="Heimatliebe Institute API", version="3.1.0", lifespan=lifespan,
              default_response_class=JSONResponse, docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=800, compresslevel=5)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Content-Security-Policy: only our own scripts may run (no inline scripts), so injected markup
# can't execute JavaScript. `frame-src https:` lets admins embed Google Docs/Forms, YouTube, H5P …
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' https:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-src 'self' https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
])
SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # CSRF protection in depth (the session cookie is already SameSite=Lax): browsers send an Origin
    # header on cross-site writes, so reject any state-changing API call coming from another site.
    if request.method in UNSAFE_METHODS and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if origin and origin != "null":
            allowed = {request.headers.get("x-forwarded-host") or request.headers.get("host", "")}
            if settings.site_url:
                allowed.add(urlparse(settings.site_url).netloc)
            if urlparse(origin).netloc not in allowed:
                return JSONResponse({"error": "Cross-site request blocked."}, status_code=403)
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - start) * 1000:.1f}"
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    if request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    message = first.get("msg", "Invalid input").removeprefix("Value error, ")
    return JSONResponse({"error": f"{field}: {message}"}, status_code=422)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"error": "Something went wrong on our side. Please try again."}, status_code=500)


# Specific routers first; the generic /api/<table> data API must come last.
for router in (auth.router, public.router, integrations.router, academics.router, finance.router,
               messaging.router, admin.router, system.router, rest.router):
    app.include_router(router)


class StaticSite(StaticFiles):
    """Serves /public with caching tuned for slow connections.

    HTML, JS and CSS revalidate with ETags on every visit (a cheap 304 when unchanged), so a new
    deploy reaches everyone immediately; the service worker additionally serves them offline.
    Images, fonts and PDFs are cached for a week.
    """

    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304):
            if path.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico", ".woff2", ".pdf")):
                response.headers["Cache-Control"] = "public, max-age=604800"
            else:
                response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/", StaticSite(directory=PUBLIC_DIR, html=True), name="site")
