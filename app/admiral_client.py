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
    return {"X-Admiral-Token": current_app.config["ADMIRAL_SHARED_TOKEN"]}


def _verify():
    ca = current_app.config["ADMIRAL_CA_FILE"]
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
        logger.error("api GET failed", extra={"path": path, "status": getattr(e.response, "status_code", None), "error": str(e)})
        _handle_request_exception(e)
        raise


def api_get_text(path):
    url = current_app.config["ADMIRAL_API_URL"] + path
    try:
        resp = requests.get(url, headers=_headers(path), verify=_verify(), timeout=30)
        resp.raise_for_status()
        return resp.text
    except requests.RequestException as e:
        logger.error("api GET text failed", extra={"path": path, "status": getattr(e.response, "status_code", None), "error": str(e)})
        _handle_request_exception(e)
        raise


def api_post(path, data=None):
    url = current_app.config["ADMIRAL_API_URL"] + path
    try:
        resp = requests.post(url, headers=_headers(path), json=data, verify=_verify(), timeout=60)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error("api POST failed", extra={"path": path, "status": getattr(e.response, "status_code", None), "error": str(e)})
        _handle_request_exception(e)
        raise


def api_delete(path):
    url = current_app.config["ADMIRAL_API_URL"] + path
    try:
        resp = requests.delete(url, headers=_headers(path), verify=_verify(), timeout=60)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error("api DELETE failed", extra={"path": path, "status": getattr(e.response, "status_code", None), "error": str(e)})
        _handle_request_exception(e)
        raise


def api_put(path, data=None):
    url = current_app.config["ADMIRAL_API_URL"] + path
    try:
        resp = requests.put(url, headers=_headers(path), json=data, verify=_verify(), timeout=60)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error("api PUT failed", extra={"path": path, "status": getattr(e.response, "status_code", None), "error": str(e)})
        _handle_request_exception(e)
        raise


def login_admin(username, password):
    url = current_app.config["ADMIRAL_API_URL"] + "/api/admin/auth/login"
    try:
        resp = requests.post(url, json={"username": username, "password": password}, verify=_verify(), timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.warning("admin login request failed", extra={"username": username, "status": getattr(e.response, "status_code", None), "error": str(e)})
        raise


def logout_admin(token):
    url = current_app.config["ADMIRAL_API_URL"] + "/api/admin/auth/logout"
    try:
        resp = requests.post(url, headers={"X-Admiral-Admin-Token": token}, verify=_verify(), timeout=30)
        return resp.status_code < 400
    except requests.RequestException as e:
        logger.warning("admin logout request failed", extra={"error": str(e)})
        return False
