# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import logging
import time

import requests
from flask import Blueprint, request, jsonify, session, current_app

logger = logging.getLogger("admiral-flagship")

bp = Blueprint("auth", __name__, url_prefix="/flagship/api/auth")
AUTH_ME_MAX_ATTEMPTS = 2
AUTH_ME_RETRY_DELAY_SECONDS = 0.2
SESSION_STARTED_AT_KEY = "session_started_at"


def _extract_error(err):
    try:
        body = err.response.json()
        return body.get("error", "Request failed")
    except Exception:
        return "Request failed"


@bp.route("/login", methods=["POST"])
def login():
    # Check rate limit via admirald (shared across workers)
    ip = request.remote_addr
    from app.admiral_client import check_rate_limit, reset_rate_limit

    allowed, remaining = check_rate_limit(ip)

    if not allowed:
        logger.warning(
            "login rate limited", extra={"ip": ip, "remaining_seconds": remaining}
        )
        return (
            jsonify(
                {
                    "error": f"Too many login attempts. Try again in {remaining} second(s)."
                }
            ),
            429,
        )

    data = request.get_json()
    if not data or not data.get("username") or not data.get("password"):
        return jsonify({"error": "username and password required"}), 400

    from app.admiral_client import login_admin

    try:
        result = login_admin(data["username"], data["password"])
        # Reset rate limit on successful login
        reset_rate_limit(ip)
        # Preserve CSRF token across session clear
        csrf_token = session.pop("csrf_token", None)
        session.clear()
        session.permanent = True
        if csrf_token:
            session["csrf_token"] = csrf_token
        session["admin_token"] = result["token"]
        session["admin_username"] = data["username"]
        session["password_change_required"] = result.get(
            "password_change_required", False
        )
        session[SESSION_STARTED_AT_KEY] = int(time.time())
        if session["password_change_required"]:
            return jsonify(
                {"password_change_required": True, "username": data["username"]}
            )
        logger.info("admin login ok", extra={"username": data["username"]})
        return jsonify({"status": "ok", "username": data["username"]})
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 401
        detail = _extract_error(e)
        logger.warning(
            "admin login failed",
            extra={"username": data["username"], "status": status, "error": detail},
        )
        return jsonify({"error": detail}), status
    except Exception as e:
        logger.warning(
            "admin login failed", extra={"username": data["username"], "error": str(e)}
        )
        return jsonify({"error": "Login failed"}), 401


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
    started_at = session.get(SESSION_STARTED_AT_KEY)
    timeout_minutes = int(current_app.config.get("SESSION_TIMEOUT_MINUTES", 30))
    if not started_at:
        return True
    return (int(time.time()) - int(started_at)) >= timeout_minutes * 60


def _validate_session_or_expire(username):
    if _session_is_expired():
        session.clear()
        logger.warning("admin session expired by timeout", extra={"username": username})
        return jsonify({"error": "session expired"}), 401
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
                return jsonify({"error": "session expired"}), 401


@bp.route("/me")
def me():
    token = session.get("admin_token")
    username = session.get("admin_username", "unknown")
    pwd_change_required = session.get("password_change_required")

    # Allow access during first-login password change flow (no token yet)
    if not token and pwd_change_required and username:
        if _session_is_expired():
            session.clear()
            return jsonify({"error": "session expired"}), 401
        session[SESSION_STARTED_AT_KEY] = int(time.time())
        return jsonify(
            {
                "username": username,
                "authenticated": True,
                "password_change_required": True,
            }
        )

    if not token:
        return jsonify({"error": "not authenticated"}), 401
    expired_response = _validate_session_or_expire(username)
    if expired_response is not None:
        return expired_response
    session[SESSION_STARTED_AT_KEY] = int(time.time())
    return jsonify(
        {
            "username": username,
            "authenticated": True,
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
            logger.warning(
                "password change failed", extra={"status": status, "error": detail}
            )
            return jsonify({"error": detail}), status
        except Exception as e:
            logger.warning("password change failed", extra={"error": str(e)})
            return jsonify({"error": "Password change failed"}), 400
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
            logger.warning(
                "password change failed", extra={"status": status, "error": detail}
            )
            return jsonify({"error": detail}), status
        except Exception as e:
            logger.warning("password change failed", extra={"error": str(e)})
            return jsonify({"error": "Password change failed"}), 400
