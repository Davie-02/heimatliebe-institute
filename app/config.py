"""Runtime configuration.

All settings come from environment variables. For local development you can put them in a
`.env` file in the project root (see `.env.example`); real environment variables always win.

APP_ENV controls safety checks:
  development  local machine, SQLite by default
  staging      test deployment of the `staging` branch; SQLite + demo data if no DATABASE_URL
  production   live site; refuses to start without DATABASE_URL and SECRET_KEY
"""
from __future__ import annotations

import os
import secrets
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = ROOT / "public"
VAR_DIR = Path(os.environ.get("HMLI_VAR_DIR", ROOT / "var"))


def _load_dotenv() -> None:
    """Minimal .env loader (KEY=value lines, # comments). Existing environment variables are kept."""
    path = ROOT / ".env"
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.split(" #", 1)[0].strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


_load_dotenv()


def _get(name: str, default: str = "") -> str:
    return os.environ.get(name, "").strip() or default


def _secret_key() -> str:
    key = _get("SECRET_KEY")
    if key:
        return key
    # Local development only: persist a generated key so logins survive restarts.
    VAR_DIR.mkdir(parents=True, exist_ok=True)
    path = VAR_DIR / "secret.key"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(48))
    return path.read_text().strip()


def _database() -> tuple[str, dict]:
    """Return an async SQLAlchemy URL plus driver options.

    Accepts the connection strings Supabase, Neon, Render and Railway hand out
    (postgres://…?sslmode=require&channel_binding=require) and converts them for asyncpg.
    """
    url = _get("DATABASE_URL")
    if not url:
        VAR_DIR.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{VAR_DIR / 'heimatliebe.db'}", {}
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+asyncpg://" + url[len(prefix):]
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    connect_args: dict = {}
    # asyncpg doesn't understand libpq-style options, so translate/remove them.
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    if sslmode in ("require", "verify-ca", "verify-full") or "supabase" in parts.netloc or "neon.tech" in parts.netloc:
        connect_args["ssl"] = "require"
    # Transaction-mode poolers (Supabase port 6543, PgBouncer) can't keep prepared statements.
    if parts.port == 6543 or query.pop("pgbouncer", None) == "true":
        connect_args["statement_cache_size"] = 0
    return urlunsplit(parts._replace(query=urlencode(query))), connect_args


@dataclass
class Settings:
    app_env: str = field(default_factory=lambda: _get("APP_ENV", "development"))
    database: tuple[str, dict] = field(default_factory=_database)
    secret_key: str = field(default_factory=_secret_key)
    site_url: str = field(default_factory=lambda: _get("SITE_URL").rstrip("/"))
    session_hours: int = field(default_factory=lambda: int(_get("SESSION_HOURS", "12")))
    cookie_secure: bool = field(default_factory=lambda: _get("COOKIE_SECURE") == "true")

    # First run: creates this superadmin when the database has no administrator yet.
    admin_user_id: str = field(default_factory=lambda: _get("ADMIN_USER_ID", "ADMIN-001"))
    admin_password: str = field(default_factory=lambda: _get("ADMIN_PASSWORD"))
    admin_email: str = field(default_factory=lambda: _get("ADMIN_EMAIL", "admin@heimatliebe.mw"))

    # Outgoing email (Brevo: smtp-relay.brevo.com, port 587).
    smtp_host: str = field(default_factory=lambda: _get("SMTP_HOST", "smtp-relay.brevo.com"))
    smtp_port: int = field(default_factory=lambda: int(_get("SMTP_PORT", "587")))
    smtp_user: str = field(default_factory=lambda: _get("SMTP_USER"))
    smtp_pass: str = field(default_factory=lambda: _get("SMTP_PASS"))
    smtp_from: str = field(default_factory=lambda: _get("SMTP_FROM"))

    # File storage: any S3-compatible service (Supabase Storage, Backblaze B2, Cloudflare R2, MinIO).
    # Leave S3_BUCKET empty to store files on the local disk (development only).
    s3_endpoint: str = field(default_factory=lambda: _get("S3_ENDPOINT").rstrip("/"))
    s3_region: str = field(default_factory=lambda: _get("S3_REGION", "us-east-1"))
    s3_bucket: str = field(default_factory=lambda: _get("S3_BUCKET"))
    s3_access_key: str = field(default_factory=lambda: _get("S3_ACCESS_KEY"))
    s3_secret_key: str = field(default_factory=lambda: _get("S3_SECRET_KEY"))

    # Optional "Sign in with Google" (Google Workspace). Restrict to one domain with GOOGLE_WORKSPACE_DOMAIN.
    google_client_id: str = field(default_factory=lambda: _get("GOOGLE_CLIENT_ID"))
    google_client_secret: str = field(default_factory=lambda: _get("GOOGLE_CLIENT_SECRET"))
    google_workspace_domain: str = field(default_factory=lambda: _get("GOOGLE_WORKSPACE_DOMAIN"))

    # Optional Redis to share realtime events between several worker processes.
    redis_url: str = field(default_factory=lambda: _get("REDIS_URL"))

    run_scheduler: bool = field(default_factory=lambda: _get("RUN_SCHEDULER", "true") != "false")
    whatsapp_number: str = field(default_factory=lambda: _get("WHATSAPP_NUMBER", "265991383466"))
    max_upload_mb: int = field(default_factory=lambda: int(_get("MAX_UPLOAD_MB", "10")))

    @property
    def database_url(self) -> str:
        return self.database[0]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_user and self.smtp_pass)

    @property
    def s3_enabled(self) -> bool:
        return bool(self.s3_bucket and self.s3_endpoint and self.s3_access_key and self.s3_secret_key)

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    def check(self) -> None:
        """Refuse to run a live site on settings that would lose data or weaken security."""
        if not self.is_production:
            return
        problems = []
        if self.is_sqlite:
            problems.append("DATABASE_URL is not set (the local SQLite file is wiped on every deploy)")
        if not _get("SECRET_KEY"):
            problems.append("SECRET_KEY is not set")
        if not self.s3_enabled:
            problems.append("S3_* storage settings are incomplete (uploaded files would be lost on redeploy)")
        if problems:
            sys.exit("Refusing to start in production:\n  - " + "\n  - ".join(problems))


settings = Settings()
