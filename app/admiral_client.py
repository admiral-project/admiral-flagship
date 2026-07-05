# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import logging

import requests
from flask import session, current_app, g

logger = logging.getLogger("admiral-flagship")


def _headers(path):
    if path.startswith("/api/admin/"):
        token = session.get("admin_token", "")
        return {"X-Admiral-Admin-Token": token}
    return {"Authorization": f"Bearer {current_app.config['ADMIRAL_ADMIN_TOKEN']}"}


def _verify():
    skip = current_app.config.get("ADMIRAL_INSECURE_SKIP_VERIFY", "")

    skip = str(skip).lower() in ("1", "true", "yes")
    if skip:
        return False
    ca = current_app.config.get("ADMIRAL_CA_FILE", "")
    return ca if ca else True


def _handle_request_exception(e):
    if e.response is not None and e.response.status_code == 401 and "admin_token" in session:
        g.unauthorized_backend_call = True


def api_get(path):
    url = current_app.config["ADMIRAL_API_URL"] + path
    try:
        resp = requests.get(url, headers=_headers(path), verify=_verify(), timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error(
            "api GET failed",
            extra={
                "path": path,
                "status": getattr(e.response, "status_code", None),
                "error": str(e),
            },
        )
        _handle_request_exception(e)
        raise


def api_get_text(path):
    url = current_app.config["ADMIRAL_API_URL"] + path
    try:
        resp = requests.get(url, headers=_headers(path), verify=_verify(), timeout=30)
        resp.raise_for_status()
        return resp.text
    except requests.RequestException as e:
        logger.error(
            "api GET text failed",
            extra={
                "path": path,
                "status": getattr(e.response, "status_code", None),
                "error": str(e),
            },
        )
        _handle_request_exception(e)
        raise


def api_post(path, data=None):
    url = current_app.config["ADMIRAL_API_URL"] + path
    try:
        resp = requests.post(url, headers=_headers(path), json=data, verify=_verify(), timeout=60)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error(
            "api POST failed",
            extra={
                "path": path,
                "status": getattr(e.response, "status_code", None),
                "error": str(e),
            },
        )
        _handle_request_exception(e)
        raise


def api_delete(path):
    url = current_app.config["ADMIRAL_API_URL"] + path
    try:
        resp = requests.delete(url, headers=_headers(path), verify=_verify(), timeout=60)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error(
            "api DELETE failed",
            extra={
                "path": path,
                "status": getattr(e.response, "status_code", None),
                "error": str(e),
            },
        )
        _handle_request_exception(e)
        raise


def api_put(path, data=None):
    url = current_app.config["ADMIRAL_API_URL"] + path
    try:
        resp = requests.put(url, headers=_headers(path), json=data, verify=_verify(), timeout=60)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error(
            "api PUT failed",
            extra={
                "path": path,
                "status": getattr(e.response, "status_code", None),
                "error": str(e),
            },
        )
        _handle_request_exception(e)
        raise


def login_admin(username, password):
    url = current_app.config["ADMIRAL_API_URL"] + "/api/admin/auth/login"
    try:
        resp = requests.post(
            url,
            json={"username": username, "password": password},
            verify=_verify(),
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.warning(
            "admin login request failed",
            extra={
                "username": username,
                "status": getattr(e.response, "status_code", None),
                "error": str(e),
            },
        )
        raise


def logout_admin(token):
    url = current_app.config["ADMIRAL_API_URL"] + "/api/admin/auth/logout"
    try:
        resp = requests.post(url, headers={"X-Admiral-Admin-Token": token}, verify=_verify(), timeout=30)
        return resp.status_code < 400
    except requests.RequestException as e:
        logger.warning("admin logout request failed", extra={"error": str(e)})
        return False


def check_rate_limit(identifier, max_attempts=5, window_seconds=60):
    """Check rate limit via admirald API.

    Returns (allowed: bool, remaining: int).
    Fails closed on error (deny access).
    """
    path = "/api/v1/rate-limit/check"
    payload = {
        "identifier": identifier,
        "max_attempts": max_attempts,
        "window_seconds": window_seconds,
    }
    try:
        resp = requests.post(
            current_app.config["ADMIRAL_API_URL"] + path,
            headers=_headers(path),
            json=payload,
            verify=_verify(),
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("allowed", True), data.get("remaining", 0)
        logger.warning(
            "rate limit check failed",
            extra={"status": resp.status_code, "identifier": identifier},
        )
    except requests.RequestException as e:
        logger.warning(
            "rate limit check request failed",
            extra={"identifier": identifier, "error": str(e)},
        )
    return False, 0


def reset_rate_limit(identifier):
    """Reset rate limit for identifier via admirald API.

    Falls back silently on failure.
    """
    path = "/api/v1/rate-limit/reset"
    payload = {"identifier": identifier}
    try:
        resp = requests.post(
            current_app.config["ADMIRAL_API_URL"] + path,
            headers=_headers(path),
            json=payload,
            verify=_verify(),
            timeout=10,
        )
        if resp.status_code != 200:
            logger.warning(
                "rate limit reset failed",
                extra={"status": resp.status_code, "identifier": identifier},
            )
    except requests.RequestException as e:
        logger.warning(
            "rate limit reset request failed",
            extra={"identifier": identifier, "error": str(e)},
        )
