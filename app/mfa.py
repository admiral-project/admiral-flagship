# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import hashlib
import hmac
import secrets
import smtplib
import time
from email.message import EmailMessage

from flask import current_app, session

OTP_TTL_SECONDS = 600


def _digest(code):
    return hmac.new(current_app.secret_key.encode(), code.encode(), hashlib.sha256).hexdigest()


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


def verify_code(code, purpose):
    expiry = session.get("mfa_code_expires_at", 0)
    digest = session.get("mfa_code_digest", "")
    valid = int(time.time()) <= int(expiry) and session.get("mfa_code_purpose") == purpose and hmac.compare_digest(digest, _digest(str(code)))
    if valid:
        for key in ("mfa_code_digest", "mfa_code_expires_at", "mfa_code_purpose"):
            session.pop(key, None)
    return valid
