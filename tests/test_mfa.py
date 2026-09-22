# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import time
from unittest.mock import patch

from app.mfa import (
    TRUSTED_DEVICE_COOKIE,
    _trusted_device_value,
    browser_is_trusted,
    clear_trusted_device,
    send_code,
    set_trusted_device,
    verify_code,
)

# -- send_code / verify_code -------------------------------------------------


def test_send_code_stores_only_digest(app, client):
    captured = {}

    class FakeSMTP:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def starttls(self):
            return "tls"

        def login(self, user, password):
            return "login"

        def send_message(self, message):
            captured["to"] = message["To"]
            captured["from"] = message["From"]
            captured["body"] = message.as_string()

    app.config.update(
        {
            "FLAGSHIP_SMTP_HOST": "smtp.test",
            "FLAGSHIP_SMTP_PORT": 587,
            "FLAGSHIP_SMTP_STARTTLS": True,
            "FLAGSHIP_SMTP_USERNAME": "user",
            "FLAGSHIP_SMTP_PASSWORD": "secret",
            "FLAGSHIP_SMTP_FROM": "noreply@admiral.test",
        }
    )
    from flask import session

    with (
        patch("smtplib.SMTP", FakeSMTP),
        patch("app.mfa.secrets.randbelow", return_value=12345678),
        app.test_request_context("/"),
    ):
        send_code("operator@admiral.test", "login")

        assert captured["to"] == "operator@admiral.test"
        assert captured["from"] == "noreply@admiral.test"
        digest = session.get("mfa_code_digest")
        assert digest
        assert "12345678" not in digest  # the raw code is never stored


def test_verify_code_single_use(app, client):
    with (
        patch("app.mfa._digest", return_value="deadbeef" * 8),
        app.test_request_context("/"),
    ):
        from flask import session

        session["mfa_code_digest"] = "deadbeef" * 8
        session["mfa_code_expires_at"] = int(time.time()) + 60
        session["mfa_code_purpose"] = "login"
        assert verify_code("12345678", "login") == "ok"
        assert "mfa_code_digest" not in session


def test_verify_code_reuse_fails(app, client):
    with (
        patch("app.mfa._digest", return_value="deadbeef" * 8),
        app.test_request_context("/"),
    ):
        from flask import session

        session["mfa_code_digest"] = "deadbeef" * 8
        session["mfa_code_expires_at"] = int(time.time()) + 60
        session["mfa_code_purpose"] = "login"
        assert verify_code("12345678", "login") == "ok"
        assert verify_code("12345678", "login") == "invalid"


def test_verify_code_expired(app, client):
    with (
        patch("app.mfa._digest", return_value="deadbeef" * 8),
        app.test_request_context("/"),
    ):
        from flask import session

        session["mfa_code_digest"] = "deadbeef" * 8
        session["mfa_code_expires_at"] = int(time.time()) - 1
        session["mfa_code_purpose"] = "login"
        assert verify_code("12345678", "login") == "expired"
        assert "mfa_code_digest" not in session


def test_verify_code_wrong_purpose(app, client):
    with (
        patch("app.mfa._digest", return_value="deadbeef" * 8),
        app.test_request_context("/"),
    ):
        from flask import session

        session["mfa_code_digest"] = "deadbeef" * 8
        session["mfa_code_expires_at"] = int(time.time()) + 60
        session["mfa_code_purpose"] = "email verification"
        assert verify_code("12345678", "login") == "invalid"


def test_send_code_fails_closed_when_smtp_not_configured(app, client):
    app.config.update(
        {
            "FLAGSHIP_SMTP_HOST": "",
            "FLAGSHIP_SMTP_FROM": "",
        }
    )
    with app.test_request_context("/"):
        try:
            send_code("operator@admiral.test", "login")
            raise AssertionError("send_code should raise when SMTP is not configured")
        except RuntimeError as exc:
            assert "not configured" in str(exc)


# -- trusted device cookie ---------------------------------------------------


def _cookie_header(value):
    return {"Cookie": f"{TRUSTED_DEVICE_COOKIE}={value}"}


def test_trusted_device_value_roundtrip(app):
    with app.test_request_context("/"):
        value = _trusted_device_value("operator")
    assert value.startswith("operator.")
    assert value.count(".") == 2
    username, _, _ = value.split(".")
    assert username == "operator"


def test_browser_is_trusted_valid(app, client):
    with app.test_request_context("/"):
        value = _trusted_device_value("operator")
    with app.test_request_context("/", headers=_cookie_header(value)):
        assert browser_is_trusted("operator") is True
        assert browser_is_trusted("other") is False


def test_browser_is_trusted_missing(app, client):
    with app.test_request_context("/"):
        assert browser_is_trusted("operator") is False


def test_browser_is_trusted_tampered(app, client):
    with app.test_request_context("/"):
        value = _trusted_device_value("operator")
    tampered = value[:-4] + "beef"
    with app.test_request_context("/", headers=_cookie_header(tampered)):
        assert browser_is_trusted("operator") is False


def test_browser_is_trusted_other_username(app, client):
    with app.test_request_context("/"):
        value = _trusted_device_value("operator-a")
    with app.test_request_context("/", headers=_cookie_header(value)):
        assert browser_is_trusted("operator-b") is False


def test_browser_is_trusted_garbage(app, client):
    with app.test_request_context("/", headers=_cookie_header("not-a-valid-cookie")):
        assert browser_is_trusted("operator") is False


def test_set_and_clear_trusted_device_cookie(app, client):
    from flask import jsonify

    with app.test_request_context("/"):
        response = set_trusted_device(jsonify({"ok": True}), "operator")
        assert TRUSTED_DEVICE_COOKIE in response.headers.get("Set-Cookie")
        assert "HttpOnly" in response.headers["Set-Cookie"]
        assert "Secure" in response.headers["Set-Cookie"]
        assert "SameSite=Strict" in response.headers["Set-Cookie"]

        clear_trusted_device(response)
        cookies = response.headers.getlist("Set-Cookie")
        cleared = [c for c in cookies if TRUSTED_DEVICE_COOKIE in c and "Max-Age=0" in c]
        assert cleared, cookies


# -- login flow integration --------------------------------------------------


def _verify_only_result(email="operator@admiral.test", mfa=True):
    return {"email": email, "mfa_email_enabled": mfa}


def test_login_untrusted_browser_requires_mfa(app, client):
    with (
        patch("app.admiral_client.check_rate_limit", return_value=(True, 0)),
        patch("app.admiral_client.login_admin") as login_mock,
        patch("app.auth.send_code") as send_mock,
    ):
        login_mock.return_value = _verify_only_result()
        resp = client.post(
            "/flagship/api/auth/login",
            json={"username": "operator", "password": "secret"},
        )
        assert resp.status_code == 200
        assert resp.json["mfa_required"] is True
        send_mock.assert_called_once()
        # No admin session is created before the code is verified.
        with client.session_transaction() as sess:
            assert "admin_token" not in sess


def test_login_trusted_browser_skips_mfa(app, client):
    with app.test_request_context("/"):
        value = _trusted_device_value("operator")
    client.set_cookie(TRUSTED_DEVICE_COOKIE, value)
    with (
        patch("app.admiral_client.check_rate_limit", return_value=(True, 0)),
        patch("app.admiral_client.reset_rate_limit"),
        patch("app.admiral_client.login_admin") as login_mock,
        patch("app.auth.send_code") as send_mock,
    ):
        login_mock.side_effect = [
            _verify_only_result(),
            {"token": "t", "password_change_required": False},
        ]
        resp = client.post(
            "/flagship/api/auth/login",
            json={"username": "operator", "password": "secret"},
        )
        assert resp.status_code == 200
        assert "mfa_required" not in resp.json
        assert resp.json["status"] == "ok"
        send_mock.assert_not_called()


def test_login_mfa_disabled_skips_code_even_untrusted(app, client):
    with (
        patch("app.admiral_client.check_rate_limit", return_value=(True, 0)),
        patch("app.admiral_client.login_admin") as login_mock,
        patch("app.auth.send_code") as send_mock,
    ):
        login_mock.side_effect = [
            _verify_only_result(mfa=False),
            {"token": "t", "password_change_required": False},
        ]
        resp = client.post(
            "/flagship/api/auth/login",
            json={"username": "operator", "password": "secret"},
        )
        assert resp.status_code == 200
        assert resp.json["status"] == "ok"
        send_mock.assert_not_called()


def test_confirm_mfa_sets_trusted_cookie(app, client):
    with client.session_transaction() as sess:
        sess["mfa_pending_username"] = "operator"
        sess["mfa_pending_at"] = int(time.time())
    with (
        patch("app.auth.verify_code", return_value="ok"),
        patch("app.admiral_client.login_admin", return_value={"token": "t", "password_change_required": False}),
    ):
        resp = client.post(
            "/flagship/api/auth/mfa/confirm",
            json={"username": "operator", "password": "secret", "code": "12345678"},
        )
        assert resp.status_code == 200
        assert resp.json["status"] == "ok"
        set_cookies = resp.headers.getlist("Set-Cookie")
        assert any(TRUSTED_DEVICE_COOKIE in c for c in set_cookies), set_cookies
        with client.session_transaction() as sess:
            assert sess.get("admin_username") == "operator"


def test_confirm_mfa_rejects_wrong_code(app, client):
    with client.session_transaction() as sess:
        sess["mfa_pending_username"] = "operator"
        sess["mfa_pending_at"] = int(time.time())
    with patch("app.auth.verify_code", return_value="invalid"):
        resp = client.post(
            "/flagship/api/auth/mfa/confirm",
            json={"username": "operator", "password": "secret", "code": "00000000"},
        )
        assert resp.status_code == 401


def test_confirm_mfa_expired_code(app, client):
    with client.session_transaction() as sess:
        sess["mfa_pending_username"] = "operator"
        sess["mfa_pending_at"] = int(time.time())
    with patch("app.auth.verify_code", return_value="expired"):
        resp = client.post(
            "/flagship/api/auth/mfa/confirm",
            json={"username": "operator", "password": "secret", "code": "12345678"},
        )
        assert resp.status_code == 401


def test_confirm_mfa_wrong_pending_username(app, client):
    with client.session_transaction() as sess:
        sess["mfa_pending_username"] = "another"
        sess["mfa_pending_at"] = int(time.time())
    resp = client.post(
        "/flagship/api/auth/mfa/confirm",
        json={"username": "operator", "password": "secret", "code": "12345678"},
    )
    assert resp.status_code == 401


def test_smtp_failure_does_not_bypass_verification(app, client):
    with (
        patch("app.admiral_client.check_rate_limit", return_value=(True, 0)),
        patch("app.admiral_client.login_admin") as login_mock,
        patch("app.auth.send_code", side_effect=RuntimeError("smtp down")),
    ):
        login_mock.return_value = _verify_only_result()
        resp = client.post(
            "/flagship/api/auth/login",
            json={"username": "operator", "password": "secret"},
        )
        assert resp.status_code == 503
        assert "mfa_required" not in resp.json
        with client.session_transaction() as sess:
            assert "admin_token" not in sess


def test_mfa_confirm_brute_force_limit(app, client):
    from app.auth import MFA_VERIFY_MAX_ATTEMPTS
    from app.rate_limit import RateLimiter

    with client.session_transaction() as sess:
        sess["mfa_pending_username"] = "operator"
        sess["mfa_pending_at"] = int(time.time())

    fresh = RateLimiter(max_attempts=MFA_VERIFY_MAX_ATTEMPTS, window_seconds=300)
    with patch("app.auth.mfa_verify_limiter", fresh), patch("app.auth.verify_code", return_value="invalid"):
        for i in range(MFA_VERIFY_MAX_ATTEMPTS):
            resp = client.post(
                "/flagship/api/auth/mfa/confirm",
                json={"username": "operator", "password": "secret", "code": "00000000"},
            )
            assert resp.status_code in (401, 429), f"attempt {i + 1} got {resp.status_code}"
        resp = client.post(
            "/flagship/api/auth/mfa/confirm",
            json={"username": "operator", "password": "secret", "code": "00000000"},
        )
        assert resp.status_code == 429


def test_mfa_resend_limit(app, client):
    from app.auth import MFA_RESEND_MAX_ATTEMPTS
    from app.rate_limit import RateLimiter

    values = [_verify_only_result() for _ in range(MFA_RESEND_MAX_ATTEMPTS + 2)]
    fresh = RateLimiter(max_attempts=MFA_RESEND_MAX_ATTEMPTS, window_seconds=3600)

    with (
        patch("app.admiral_client.check_rate_limit", return_value=(True, 0)),
        patch("app.admiral_client.login_admin") as login_mock,
        patch("app.auth.send_code"),
        patch("app.auth.mfa_resend_limiter", fresh),
        patch("app.auth.MFA_RESEND_COOLDOWN_SECONDS", 0),
    ):
        login_mock.side_effect = values
        for i in range(MFA_RESEND_MAX_ATTEMPTS):
            resp = client.post(
                "/flagship/api/auth/login",
                json={"username": "operator", "password": "secret"},
            )
            assert resp.status_code == 200, f"resend attempt {i + 1} got {resp.status_code}"
        resp = client.post(
            "/flagship/api/auth/login",
            json={"username": "operator", "password": "secret"},
        )
        assert resp.status_code == 429
        assert "Too many" in resp.json["error"]


def test_login_audit_log_omits_code(app, client):
    import logging
    from io import StringIO

    logger = logging.getLogger("admiral-flagship")
    stream = StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    try:
        with (
            patch("app.admiral_client.check_rate_limit", return_value=(True, 0)),
            patch("app.admiral_client.login_admin") as login_mock,
            patch("app.auth.send_code") as send_mock,
        ):
            login_mock.return_value = _verify_only_result()
            send_mock.side_effect = lambda *a, **k: None
            resp = client.post(
                "/flagship/api/auth/login",
                json={"username": "operator", "password": "secret"},
            )
            assert resp.status_code == 200
    finally:
        logger.removeHandler(handler)
    joined = stream.getvalue()
    assert "mfa code issued" in joined
    # No logging of the code, the email, or SMTP credentials.
    assert "operator@admiral.test" not in joined
    assert "12345678" not in joined


def test_forget_device_endpoint(app, client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "t"
        sess["admin_username"] = "operator"
        sess["session_started_at"] = int(time.time())
    resp = client.post("/flagship/api/auth/profile/device/forget")
    assert resp.status_code == 200
    cookies = resp.headers.getlist("Set-Cookie")
    assert any(TRUSTED_DEVICE_COOKIE in c and "Max-Age=0" in c for c in cookies), cookies
