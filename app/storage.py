"""File storage.

Two interchangeable backends:
  * local disk (development)            var/uploads/<bucket>/<name>
  * any S3-compatible object store      Supabase Storage, Backblaze B2, Cloudflare R2, MinIO …

Whatever the backend, the app hands out the same stable URLs, so switching providers never
breaks links already saved in the database:
  /files/<bucket>/<name>       public files (gallery, library, news images …), cached by browsers
  /api/files/<bucket>/<name>   private files (payment proofs, submissions), access-checked per request

"Buckets" are folders inside ONE storage bucket (S3_BUCKET), so only one needs creating.
File names start with the uploader's user ID, which is how ownership of private files is checked.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit

import anyio
import httpx
from fastapi import HTTPException

from .config import VAR_DIR, settings

PUBLIC_BUCKETS = {"uploads", "gallery", "documents", "library-files", "library-covers", "avatars", "news"}
PRIVATE_BUCKETS = {"payment-proofs", "submissions", "registrations"}
BUCKETS = PUBLIC_BUCKETS | PRIVATE_BUCKETS

ALLOWED_EXT = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".doc", ".docx", ".odt", ".txt", ".epub", ".zip",
    ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".ppt", ".pptx", ".xls", ".xlsx", ".csv",
}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
IMAGE_ONLY = {"gallery", "avatars", "library-covers", "news"}
LOCAL_ROOT = VAR_DIR / "uploads"
MAX_IMAGE_SIDE = 1600
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")


# ── Validation & image optimisation ──────────────────────────────────────
def validate(bucket: str, filename: str, size: int) -> str:
    if bucket not in BUCKETS:
        raise HTTPException(400, "Unknown upload area.")
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"File type {ext or '(none)'} is not allowed.")
    if bucket in IMAGE_ONLY and ext not in IMAGE_EXT:
        raise HTTPException(400, "Please upload an image (PNG, JPG, GIF or WEBP).")
    if size == 0:
        raise HTTPException(400, "The file is empty.")
    if size > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {settings.max_upload_mb} MB.")
    return ext


def optimise_image(data: bytes, ext: str) -> tuple[bytes, str]:
    """Resize large photos and convert them to WebP — often 5–10× smaller, which matters on mobile data.

    Animated GIFs and anything Pillow can't read are stored unchanged. Also strips EXIF data
    (phone photos can contain GPS coordinates).
    """
    if ext == ".gif":
        return data, ext
    try:
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "transparency" in img.info else "RGB")
        out = io.BytesIO()
        img.save(out, "WEBP", quality=80, method=4)
        if out.tell() < len(data):
            return out.getvalue(), ".webp"
    except Exception:
        pass  # not a readable image, keep the original bytes
    return data, ext


# ── S3 request signing (AWS Signature Version 4) ─────────────────────────
def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sigv4_headers(method: str, url: str, headers: dict[str, str], payload_hash: str, *, access_key: str,
                  secret_key: str, region: str, now: datetime | None = None) -> dict[str, str]:
    """Return `headers` plus the x-amz-* and Authorization headers for an S3 request."""
    now = now or datetime.now(timezone.utc)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    parts = urlsplit(url)
    signed = {k.lower(): v.strip() for k, v in headers.items()}
    signed.update({"host": parts.netloc, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date})
    names = sorted(signed)
    canonical = "\n".join([
        method, quote(parts.path or "/", safe="/-_.~"), parts.query,
        "".join(f"{k}:{signed[k]}\n" for k in names), ";".join(names), payload_hash])
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    key = _hmac(_hmac(_hmac(_hmac(("AWS4" + secret_key).encode(), day), region), "s3"), "aws4_request")
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    out = {k: v for k, v in signed.items() if k != "host"}
    out["authorization"] = (f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
                            f"SignedHeaders={';'.join(names)}, Signature={signature}")
    return out


async def _s3(method: str, key: str, body: bytes = b"", content_type: str | None = None) -> httpx.Response:
    url = f"{settings.s3_endpoint}/{settings.s3_bucket}/{key}"
    headers = {"content-type": content_type} if content_type else {}
    signed = sigv4_headers(method, url, headers, hashlib.sha256(body).hexdigest(),
                           access_key=settings.s3_access_key, secret_key=settings.s3_secret_key,
                           region=settings.s3_region)
    async with httpx.AsyncClient(timeout=60) as client:
        return await client.request(method, url, content=body or None, headers=signed)


# ── Public API ───────────────────────────────────────────────────────────
def url_for(bucket: str, name: str) -> str:
    return f"/files/{bucket}/{name}" if bucket in PUBLIC_BUCKETS else f"/api/files/{bucket}/{name}"


async def save(bucket: str, filename: str, data: bytes, owner_id: str | None) -> str:
    """Store an upload and return its stable URL."""
    ext = validate(bucket, filename, len(data))
    if ext in IMAGE_EXT:
        data, ext = await anyio.to_thread.run_sync(optimise_image, data, ext)
    name = f"{(owner_id or 'anon')[:36]}__{uuid.uuid4().hex}{ext}"
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    if settings.s3_enabled:
        r = await _s3("PUT", f"{bucket}/{name}", data, ctype)
        if r.status_code >= 300:
            raise HTTPException(502, "File storage is unavailable. Please try again.")
    else:
        path = LOCAL_ROOT / bucket / name
        await anyio.to_thread.run_sync(_write, path, data)
    return url_for(bucket, name)


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def owner_of(name: str) -> str:
    return name.split("__", 1)[0]


async def read(bucket: str, name: str) -> tuple[bytes, str]:
    if bucket not in BUCKETS or not _SAFE_NAME.match(name):
        raise HTTPException(404, "File not found.")
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    if settings.s3_enabled:
        r = await _s3("GET", f"{bucket}/{name}")
        if r.status_code != 200:
            raise HTTPException(404, "File not found.")
        return r.content, ctype
    path = LOCAL_ROOT / bucket / name
    if not path.is_file():
        raise HTTPException(404, "File not found.")
    return await anyio.to_thread.run_sync(path.read_bytes), ctype


async def delete(url: str) -> None:
    m = re.search(r"/(?:api/)?files/([a-z-]+)/([A-Za-z0-9_.-]+)$", url or "")
    if not m or m.group(1) not in BUCKETS:
        return
    bucket, name = m.groups()
    if settings.s3_enabled:
        await _s3("DELETE", f"{bucket}/{name}")
    else:
        path = LOCAL_ROOT / bucket / name
        await anyio.to_thread.run_sync(lambda: path.unlink(missing_ok=True))
