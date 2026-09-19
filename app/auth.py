# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import logging
import time

import requests
from flask import Blueprint, current_app, jsonify, request, session

logger = logging.getLogger("admiral-flagship")

bp = Blueprint("auth", __name__, url_prefix="/flagship/api/auth")
AUTH_ME_MAX_ATTEMPTS = 2
AUTH_ME_RETRY_DELAY_SECONDS = 0.2
SESSION_STARTED_AT_KEY = "session_started_at"
SESSION_ACTIVITY_AT_KEY = "session_activity_at"
SESSION_LOGIN_AT_KEY = "session_login_at"


def _extract_error(err):
    try:
        body = err.response.json()
        return body.get("error", "Request failed")
    except Exception:
        return "Request failed"


def _generic_auth_failure(status=401):
    return jsonify({"error": "unauthorized"}), status


@bp.route("/login", methods=["POST"])
def login():
    # Check rate limit via admirald (shared across workers)
    ip = request.remote_addr
    from app.admiral_client import check_rate_limit, reset_rate_limit

    allowed, remaining = check_rate_limit(ip)

    if not allowed:
        logger.warning("login rate limited", extra={"ip": ip, "remaining_seconds": remaining})
        return (
            jsonify({"error": f"Too many login attempts. Try again in {remaining} second(s)."}),
            429,
        )

    data = request.get_json()
    if not data or not data.get("username") or not data.get("password"):
        return jsonify({"error": "username and password required"}), 400

    from app.admiral_client import login_admin

    try:
        result = login_admin(data["username"], data["password"], verify_only=True)
        if result.get("mfa_email_enabled"):
            from app.mfa import send_code

            session.clear()
            session["mfa_pending_username"] = data["username"]
            session["mfa_pending_at"] = int(time.time())
            try:
                send_code(result["email"], "login")
            except Exception:
                logger.warning("MFA email delivery failed", extra={"username": data["username"]})
                return _generic_auth_failure(503)
            # The browser resubmits the password with the code. No bearer token
            # is kept in the Flask session before MFA completes.
            return jsonify({"mfa_required": True})
        result = login_admin(data["username"], data["password"])
        # Reset rate limit on successful login
        reset_rate_limit(ip)
        # Generate a fresh CSRF token on login to prevent session fixation.
        session.clear()
        session.permanent = True
        from app.csrf import _generate_token

        session["csrf_token"] = _generate_token()
        session["admin_token"] = result["token"]
        session["admin_username"] = data["username"]
        session["password_change_required"] = result.get("password_change_required", False)
        session[SESSION_STARTED_AT_KEY] = int(time.time())
        session[SESSION_LOGIN_AT_KEY] = session[SESSION_STARTED_AT_KEY]
        session[SESSION_ACTIVITY_AT_KEY] = session[SESSION_STARTED_AT_KEY]
        if session["password_change_required"]:
            return jsonify({"password_change_required": True, "username": data["username"]})
        logger.info("admin login ok", extra={"username": data["username"]})
        return jsonify({"status": "ok", "username": data["username"]})
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 401
        detail = _extract_error(e)
        logger.warning(
            "[client %s] admin login failed",
            ip,
            extra={"username": data["username"], "status": status, "error": detail, "ip": ip},
        )
        return _generic_auth_failure(status if status in (401, 403) else 401)
    except Exception as e:
        logger.warning(
            "[client %s] admin login failed",
            ip,
            extra={"username": data["username"], "error": str(e), "ip": ip},
        )
        return _generic_auth_failure()


@bp.route("/mfa/confirm", methods=["POST"])
def confirm_mfa():
    data = request.get_json() or {}
    username = data.get("username", "")
    password = data.get("password", "")
    code = str(data.get("code", ""))
    if not username or not password or not code or session.get("mfa_pending_username") != username:
        return _generic_auth_failure()
    from app.mfa import verify_code

    if not verify_code(code, "login"):
        return _generic_auth_failure()
    from app.admiral_client import login_admin

    try:
        result = login_admin(username, password)
    except requests.RequestException:
        return _generic_auth_failure()
    session.clear()
    session.permanent = True
    from app.csrf import _generate_token

    session["csrf_token"] = _generate_token()
    session["admin_token"] = result["token"]
    session["admin_username"] = username
    session["password_change_required"] = result.get("password_change_required", False)
    session[SESSION_STARTED_AT_KEY] = int(time.time())
    session[SESSION_LOGIN_AT_KEY] = session[SESSION_STARTED_AT_KEY]
    session[SESSION_ACTIVITY_AT_KEY] = session[SESSION_STARTED_AT_KEY]
    return jsonify({"status": "ok", "username": username})


@bp.route("/profile", methods=["GET", "PUT"])
def profile():
    if "admin_token" not in session:
        return _generic_auth_failure()
    from app.admiral_client import get_operator_profile, update_operator_profile

    if request.method == "GET":
        try:
            return jsonify(get_operator_profile())
        except requests.RequestException:
            return _generic_auth_failure()
    data = request.get_json() or {}
    email = str(data.get("email", "")).strip()
    try:
        current = get_operator_profile()
        # Enabling MFA always requires the separate email verification flow.
        if data.get("mfa_email_enabled") and not current.get("email_verified_at"):
            return jsonify({"error": "verify email before enabling MFA"}), 400
        return jsonify(
            update_operator_profile(
                email,
                bool(current.get("email_verified_at")) and email == current.get("email"),
                bool(data.get("mfa_email_enabled")),
            )
        )
    except requests.RequestException:
        return jsonify({"error": "profile update failed"}), 400


@bp.route("/profile/email/request", methods=["POST"])
def request_profile_email():
    if "admin_token" not in session:
        return _generic_auth_failure()
    email = str((request.get_json() or {}).get("email", "")).strip().lower()
    if not email or "@" not in email:
        return jsonify({"error": "valid email required"}), 400
    session["email_verification_address"] = email
    from app.mfa import send_code

    try:
        send_code(email, "email verification")
    except Exception:
        logger.warning("profile email delivery failed", extra={"username": session.get("admin_username")})
        return jsonify({"error": "email verification is unavailable"}), 503
    return jsonify({"status": "verification_sent"})


@bp.route("/profile/email/confirm", methods=["POST"])
def confirm_profile_email():
    if "admin_token" not in session:
        return _generic_auth_failure()
    data = request.get_json() or {}
    from app.mfa import verify_code

    if not verify_code(str(data.get("code", "")), "email verification"):
        return jsonify({"error": "invalid verification code"}), 400
    email = session.pop("email_verification_address", "")
    if not email:
        return jsonify({"error": "email verification expired"}), 400
    from app.admiral_client import update_operator_profile

    try:
        return jsonify(update_operator_profile(email, True, False))
    except requests.RequestException:
        return jsonify({"error": "profile update failed"}), 400


@bp.route("/profile/mfa/disable", methods=["POST"])
def disable_profile_mfa():
    if "admin_token" not in session:
        return _generic_auth_failure()
    password = str((request.get_json() or {}).get("current_password", ""))
    if not password:
        return jsonify({"error": "current_password required"}), 400
    from app.admiral_client import get_operator_profile, login_admin, update_operator_profile

    try:
        login_admin(session.get("admin_username", ""), password, verify_only=True)
        current = get_operator_profile()
        return jsonify(update_operator_profile(current.get("email", ""), bool(current.get("email_verified_at")), False))
    except requests.RequestException:
        return _generic_auth_failure()


@bp.route("/logout", methods=["POST"])
def logout():
    username = session.get("admin_username", "unknown")
    token = session.pop("admin_token", None)
    session.pop("admin_username", None)
    session.clear()
    if token:
        from app.admiral_client import logout_admin

        try:
            logout_admin(token)
        except Exception as exc:
            logger.debug("logout_admin call failed", extra={"error": str(exc)})
    logger.info("admin logout", extra={"username": username})
    return jsonify({"status": "logged_out"})


def _session_is_expired():
    started_at = session.get(SESSION_ACTIVITY_AT_KEY, session.get(SESSION_STARTED_AT_KEY))
    timeout_minutes = int(current_app.config.get("SESSION_TIMEOUT_MINUTES", 30))
    if not started_at:
        return True
    return (int(time.time()) - int(started_at)) >= timeout_minutes * 60


def _session_absolute_expired():
    """Check if session has exceeded the absolute maximum lifetime (24 hours)."""
    started_at = session.get(SESSION_LOGIN_AT_KEY, session.get(SESSION_STARTED_AT_KEY))
    abs_max_hours = int(current_app.config.get("SESSION_ABSOLUTE_TIMEOUT_HOURS", 24))
    if not started_at:
        return True
    return (int(time.time()) - int(started_at)) >= abs_max_hours * 3600


def _validate_session_or_expire(username):
    if _session_is_expired():
        session.clear()
        logger.warning("admin session expired by timeout", extra={"username": username})
        return _generic_auth_failure()
    from app.admiral_client import api_get

    last_error = None
    for attempt in range(AUTH_ME_MAX_ATTEMPTS):
        try:
            api_get("/api/admin/auth/me")
            return None
        except Exception as exc:
            last_error = exc
            if attempt + 1 < AUTH_ME_MAX_ATTEMPTS:
                time.sleep(AUTH_ME_RETRY_DELAY_SECONDS)
            else:
                session.clear()
                logger.warning(
                    "admin session expired after admirald check failed",
                    extra={"username": username, "error": str(last_error)},
                )
                return _generic_auth_failure()


@bp.route("/me")
def me():
    token = session.get("admin_token")
    username = session.get("admin_username", "unknown")
    pwd_change_required = session.get("password_change_required")

    # Allow access during first-login password change flow (no token yet)
    if not token and pwd_change_required and username:
        if _session_is_expired():
            session.clear()
            return _generic_auth_failure()
        session[SESSION_ACTIVITY_AT_KEY] = int(time.time())
        return jsonify(
            {
                "username": username,
                "authenticated": True,
                "role": "admin",
                "password_change_required": True,
            }
        )

    if not token:
        return _generic_auth_failure()
    expired_response = _validate_session_or_expire(username)
    if expired_response is not None:
        return expired_response
    session[SESSION_ACTIVITY_AT_KEY] = int(time.time())
    return jsonify(
        {
            "username": username,
            "authenticated": True,
            "role": "admin",
            "password_change_required": session.get("password_change_required", False),
        }
    )


@bp.route("/change-password", methods=["POST"])
def change_password():
    data = request.get_json()
    if not data or not data.get("current_password") or not data.get("new_password"):
        return jsonify({"error": "current_password and new_password are required"}), 400
    token = session.get("admin_token")
    username = session.get("admin_username", "unknown")
    if token:
        expired_response = _validate_session_or_expire(username)
        if expired_response is not None:
            return expired_response
    from app.admiral_client import api_post

    payload = {
        "current_password": data["current_password"],
        "new_password": data["new_password"],
    }
    if token:
        try:
            result = api_post("/api/admin/auth/change-password", payload)
            logger.info("password changed", extra={"username": username})
            return jsonify(result)
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else 400
            detail = _extract_error(e)
            logger.warning("password change failed", extra={"status": status, "error": detail})
            return _generic_auth_failure(status if status in (401, 403) else 400)
        except Exception as e:
            logger.warning("password change failed", extra={"error": str(e)})
            return jsonify({"error": "password change failed"}), 400
    else:
        username = data.get("username")
        if not username:
            return (
                jsonify({"error": "username required for first-login password change"}),
                400,
            )
        payload["username"] = username
        try:
            result = api_post("/api/admin/auth/change-password", payload)
            logger.info("password changed (first login)", extra={"username": username})
            return jsonify(result)
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else 400
            detail = _extract_error(e)
            logger.warning("password change failed", extra={"status": status, "error": detail})
            return _generic_auth_failure(status if status in (401, 403) else 400)
        except Exception as e:
            logger.warning("password change failed", extra={"error": str(e)})
            return jsonify({"error": "password change failed"}), 400
