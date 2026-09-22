# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import hashlib
import hmac
import secrets
import smtplib
import time
from email.message import EmailMessage

from flask import current_app, request, session

OTP_TTL_SECONDS = 600

# Trusted browser cookie: marks a browser that already completed the
# single-use email verification flow for a given operator. It is signed with
# the Flagship secret key, bound to the operator username and to an expiry,
# so it cannot be forged or replayed for another operator.
TRUSTED_DEVICE_COOKIE = "flagship_trusted_device"
TRUSTED_DEVICE_DEFAULT_DAYS = 30


def _digest(code):
    return hmac.new(current_app.secret_key.encode(), code.encode(), hashlib.sha256).hexdigest()


def _trusted_digest(username, expiry_epoch):
    mac = hmac.new(current_app.secret_key.encode(), f"{username}:{expiry_epoch}".encode(), hashlib.sha256)
    return mac.hexdigest()


def _trusted_device_days():
    return int(current_app.config.get("TRUSTED_DEVICE_DAYS", TRUSTED_DEVICE_DEFAULT_DAYS))


def _trusted_device_value(username):
    expiry = int(time.time()) + _trusted_device_days() * 86400
    return f"{username}.{expiry}.{_trusted_digest(username, expiry)}"


def trusted_device_username():
    """Return the operator bound to a valid trusted-device cookie, or None."""
    raw = request.cookies.get(TRUSTED_DEVICE_COOKIE, "")
    if not raw:
        return None
    parts = raw.split(".")
    if len(parts) != 3:
        return None
    username, expiry_s, digest = parts
    try:
        expiry = int(expiry_s)
    except ValueError:
        return None
    if time.time() > expiry:
        return None
    if not hmac.compare_digest(_trusted_digest(username, expiry), digest):
        return None
    return username


def browser_is_trusted(username):
    return trusted_device_username() == username


def set_trusted_device(response, username):
    """Stamp a signed trusted-device cookie on an outgoing response."""
    secure = bool(current_app.config.get("SESSION_COOKIE_SECURE", True))
    response.set_cookie(
        TRUSTED_DEVICE_COOKIE,
        _trusted_device_value(username),
        max_age=_trusted_device_days() * 86400,
        httponly=True,
        secure=secure,
        samesite="Strict",
        path="/",
    )
    return response


def clear_trusted_device(response):
    """Revoke the trusted-device cookie on an outgoing response."""
    secure = bool(current_app.config.get("SESSION_COOKIE_SECURE", True))
    response.set_cookie(
        TRUSTED_DEVICE_COOKIE,
        "",
        max_age=0,
        httponly=True,
        secure=secure,
        samesite="Strict",
        path="/",
    )
    return response


def send_code(email, purpose):
    host = current_app.config["FLAGSHIP_SMTP_HOST"]
    sender = current_app.config["FLAGSHIP_SMTP_FROM"]
    if not host or not sender:
        raise RuntimeError("email MFA is not configured")
    code = f"{secrets.randbelow(100_000_000):08d}"
    message = EmailMessage()
    message["From"] = sender
    message["To"] = email
    message["Subject"] = "Admiral verification code"
    message.set_content(f"Your Admiral {purpose} code is: {code}\nIt expires in 10 minutes.")
    with smtplib.SMTP(host, current_app.config["FLAGSHIP_SMTP_PORT"], timeout=10) as smtp:
        if current_app.config["FLAGSHIP_SMTP_STARTTLS"]:
            smtp.starttls()
        if current_app.config["FLAGSHIP_SMTP_USERNAME"]:
            smtp.login(current_app.config["FLAGSHIP_SMTP_USERNAME"], current_app.config["FLAGSHIP_SMTP_PASSWORD"])
        smtp.send_message(message)
    session["mfa_code_digest"] = _digest(code)
    session["mfa_code_expires_at"] = int(time.time()) + OTP_TTL_SECONDS
    session["mfa_code_purpose"] = purpose
    session["mfa_code_sent_at"] = int(time.time())


def verify_code(code, purpose):
    """Consume a single-use code.

    Returns "ok", "expired", or "invalid". On success the outstanding code is
    invalidated immediately so it cannot be reused.
    """
    expiry = session.get("mfa_code_expires_at", 0)
    digest = session.get("mfa_code_digest", "")
    if not digest:
        return "invalid"
    if session.get("mfa_code_purpose") != purpose:
        return "invalid"
    if int(time.time()) > int(expiry):
        for key in ("mfa_code_digest", "mfa_code_expires_at", "mfa_code_purpose", "mfa_code_sent_at"):
            session.pop(key, None)
        return "expired"
    if not hmac.compare_digest(digest, _digest(str(code))):
        return "invalid"
    for key in ("mfa_code_digest", "mfa_code_expires_at", "mfa_code_purpose", "mfa_code_sent_at"):
        session.pop(key, None)
    session["mfa_code_consumed_at"] = int(time.time())
    return "ok"
