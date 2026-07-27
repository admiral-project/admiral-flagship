# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import re

from flask import Blueprint, jsonify, request

from app.admiral_client import api_get, api_get_text, api_post, api_put
from app.bff.pagination import normalize_page, parse_paging_args
from app.security import validate_resource_id

bp = Blueprint("bff_catalog", __name__, url_prefix="/flagship/api/catalog")

_VERSION_RE = re.compile(r"(?m)^version:\s*[\"']?([^\"'\n]+)[\"']?\s*$")


def validate_app_id(app_id):
    validate_resource_id(app_id, "app")


def _extract_tiers(yaml_text):
    tiers = []
    lines = yaml_text.splitlines()
    in_tiers = False
    current = None
    current_indent = None

    for raw_line in lines:
        line = raw_line.rstrip("\n")
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        indent = len(line) - len(line.lstrip(" "))
        if not in_tiers:
            if stripped == "tiers:":
                in_tiers = True
            continue

        if indent == 0:
            break

        if indent == 2 and stripped.endswith(":"):
            if current:
                tiers.append(current)
            current = {
                "name": stripped[:-1],
                "cpu": None,
                "memory": None,
                "storage": None,
                "price_monthly": None,
            }
            current_indent = indent
            continue

        if current and indent > current_indent and ":" in stripped:
            key, value = stripped.split(":", 1)
            current[key.strip()] = value.strip().strip('"').strip("'")

    if current:
        tiers.append(current)
    return tiers


def _bump_version(yaml_text):
    match = _VERSION_RE.search(yaml_text)
    if not match:
        raise ValueError("version field is required when editing an app definition")

    current = match.group(1).strip()
    parts = current.split(".")
    if not all(part.isdigit() for part in parts):
        raise ValueError("version must use only numeric segments to support automatic increment")

    parts[-1] = str(int(parts[-1]) + 1)
    bumped = ".".join(parts)
    return _VERSION_RE.sub(f"version: {bumped}", yaml_text, count=1), bumped


@bp.route("/apps")
def list_apps():
    from app.security import sanitize_error_message

    page, page_size = parse_paging_args()
    try:
        data = api_get("/api/v1/apps")
        return jsonify(normalize_page(data, "apps", page, page_size))
    except Exception as e:
        msg = sanitize_error_message(e, "list_apps")
        return (
            jsonify(
                {
                    "error": msg,
                    "apps": [],
                    "items": [],
                    "page": page,
                    "page_size": page_size,
                    "total": 0,
                }
            ),
            502,
        )


@bp.route("/apps/<app_id>")
def app_detail(app_id):
    from app.security import sanitize_error_message

    validate_app_id(app_id)

    try:
        app = api_get(f"/api/admin/apps/{app_id}")
        return jsonify({"app": app})
    except Exception as e:
        msg = sanitize_error_message(e, "app_detail")
        return jsonify({"error": msg}), 502


@bp.route("/apps/<app_id>/yaml")
def app_yaml(app_id):
    from app.security import sanitize_error_message

    validate_app_id(app_id)

    try:
        yaml_text = api_get_text(f"/api/admin/apps/{app_id}/yaml")
        return jsonify({"yaml": yaml_text})
    except Exception as e:
        msg = sanitize_error_message(e, "app_yaml")
        return jsonify({"error": msg}), 502


@bp.route("/apps/<app_id>/provisioning")
def app_provisioning(app_id):
    from app.security import sanitize_error_message

    validate_app_id(app_id)

    try:
        app = api_get(f"/api/admin/apps/{app_id}")
        yaml_text = api_get_text(f"/api/admin/apps/{app_id}/yaml")
        tiers = sorted(_extract_tiers(yaml_text), key=lambda item: item["name"])
        return jsonify(
            {
                "app": app,
                "tiers": tiers,
            }
        )
    except Exception as e:
        msg = sanitize_error_message(e, "app_provisioning")
        return jsonify({"error": msg}), 502


@bp.route("/apps/save", methods=["POST"])
def save_app():
    from app.security import sanitize_error_message

    payload = request.get_json(silent=True) or {}
    yaml_text = payload.get("yaml", "")
    app_id = payload.get("app_id", "")
    if not yaml_text.strip():
        return jsonify({"error": "yaml is required"}), 400
    try:
        if app_id:
            yaml_text, bumped_version = _bump_version(yaml_text)
        else:
            bumped_version = None
        result = api_post("/api/admin/apps", {"yaml": yaml_text})
        if bumped_version is not None:
            result["version"] = bumped_version
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        msg = sanitize_error_message(e, "save_app")
        return jsonify({"error": msg}), 502


@bp.route("/apps/<app_id>/tiers")
def app_tiers(app_id):
    from app.security import sanitize_error_message

    validate_app_id(app_id)

    try:
        tiers = api_get(f"/api/admin/apps/{app_id}/tiers")
        return jsonify({"tiers": tiers if isinstance(tiers, list) else []})
    except Exception as e:
        msg = sanitize_error_message(e, "app_tiers")
        return jsonify({"error": msg, "tiers": []}), 502


@bp.route("/apps/<app_id>/tiers", methods=["POST"])
def save_app_tier(app_id):
    from app.security import sanitize_error_message

    validate_app_id(app_id)

    body = request.get_json(silent=True) or {}
    if not body.get("tier"):
        return jsonify({"error": "tier object required"}), 400
    try:
        result = api_post(f"/api/admin/apps/{app_id}/tiers", body["tier"])
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "save_app_tier")
        return jsonify({"error": msg}), 502


@bp.route("/apps/<app_id>/versions")
def app_versions(app_id):
    from app.security import sanitize_error_message

    validate_app_id(app_id)

    try:
        versions = api_get(f"/api/admin/apps/{app_id}/versions")
        return jsonify({"versions": versions if isinstance(versions, list) else []})
    except Exception as e:
        msg = sanitize_error_message(e, "app_versions")
        return jsonify({"error": msg, "versions": []}), 502


@bp.route("/apps/<app_id>/disable", methods=["POST"])
def disable_app(app_id):
    from app.security import sanitize_error_message

    validate_app_id(app_id)

    try:
        result = api_put(f"/api/admin/apps/{app_id}/status", {"status": "inactive"})
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "disable_app")
        return jsonify({"error": msg}), 502


@bp.route("/apps/<app_id>/enable", methods=["POST"])
def enable_app(app_id):
    from app.security import sanitize_error_message

    validate_app_id(app_id)

    try:
        result = api_put(f"/api/admin/apps/{app_id}/status", {"status": "active"})
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "enable_app")
        return jsonify({"error": msg}), 502
