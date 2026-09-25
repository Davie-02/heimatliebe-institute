"""Outgoing email. Sending happens in background tasks so requests never wait on SMTP."""
from __future__ import annotations

import html
import logging
from email.message import EmailMessage

from .config import settings

log = logging.getLogger("hmli.mail")


async def send_email(to: str, subject: str, html_body: str) -> bool:
    if not settings.email_enabled or not to:
        log.info("email disabled; would send %r to %s", subject, to)
        return False
    import aiosmtplib

    msg = EmailMessage()
    msg["From"] = settings.smtp_from or f"Heimatliebe Institute <{settings.smtp_user}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content("This message requires an HTML-capable email client.")
    msg.add_alternative(html_body, subtype="html")
    try:
        await aiosmtplib.send(
            msg, hostname=settings.smtp_host, port=settings.smtp_port,
            username=settings.smtp_user, password=settings.smtp_pass,
            use_tls=settings.smtp_port == 465, start_tls=settings.smtp_port == 587, timeout=20,
        )
        return True
    except Exception as exc:
        log.warning("email to %s failed: %s", to, exc)
        return False


def layout(eyebrow: str, heading: str, body_html: str) -> str:
    """Branded email shell. `body_html` must already be escaped by the caller."""
    wa = settings.whatsapp_number
    return f"""<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F7F5EF;font-family:Inter,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5EF;padding:40px 16px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-top:4px solid #C9A84C">
<tr><td style="background:#1B4332;padding:28px 36px">
<p style="margin:0;font-family:Georgia,serif;font-size:20px;font-weight:700;color:#C9A84C">Heimatliebe <span style="color:rgba(255,255,255,.75);font-weight:400">Institute</span></p>
<p style="margin:6px 0 0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.4)">{html.escape(eyebrow)}</p></td></tr>
<tr><td style="padding:36px 36px 28px">
<h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:24px;font-weight:700;color:#1B4332;line-height:1.2">{html.escape(heading)}</h1>
<div style="font-size:15px;color:#4A6572;line-height:1.7">{body_html}</div>
<p style="margin:24px 0 0;font-size:13px;color:#4A6572;line-height:1.7">Questions? Contact us on
<a href="https://wa.me/{wa}" style="color:#2D6A4F;font-weight:600">WhatsApp +{wa}</a>.</p>
</td></tr></table></td></tr></table></body></html>"""


def button(url: str, label: str) -> str:
    return (f'<p style="text-align:center;margin:28px 0"><a href="{html.escape(url)}" style="display:inline-block;'
            f'padding:14px 32px;background:#C9A84C;color:#1B4332;text-decoration:none;font-weight:700;'
            f'font-size:15px;letter-spacing:.08em;border-radius:2px">{html.escape(label)}</a></p>')


def id_box(label: str, value: str) -> str:
    return (f'<table width="100%" cellpadding="0" cellspacing="0" style="background:#1B4332;margin:20px 0"><tr>'
            f'<td style="padding:24px;text-align:center"><p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;'
            f'text-transform:uppercase;color:rgba(255,255,255,.5)">{html.escape(label)}</p><p style="margin:0;'
            f'font-family:\'Courier New\',monospace;font-size:26px;font-weight:700;color:#C9A84C;letter-spacing:3px">'
            f'{html.escape(value)}</p></td></tr></table>')
