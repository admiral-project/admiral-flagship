# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import re

from flask import Blueprint, jsonify, request

from app.admiral_client import api_delete, api_get, api_post, api_put
from app.bff.pagination import normalize_page, parse_paging_args
from app.security import validate_resource_id

bp = Blueprint("bff_backups", __name__, url_prefix="/flagship/api/backups")


def validate_backup_id(backup_id):
    validate_resource_id(backup_id, "backup")


@bp.route("")
def list_backups():
    from urllib.parse import urlencode

    from app.security import sanitize_error_message

    instance_id = request.args.get("instance_id", "").strip()
    page, page_size = parse_paging_args()
    try:
        params = {"page": page, "page_size": page_size}
        if instance_id:
            validate_resource_id(instance_id, "instance")
            params["instance_id"] = instance_id

        path = f"/api/admin/backups?{urlencode(params)}"
        data = api_get(path)
        return jsonify(normalize_page(data, "backups", page, page_size))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        msg = sanitize_error_message(e, "list_backups")
        return (
            jsonify(
                {
                    "error": msg,
                    "backups": [],
                    "items": [],
                    "page": page,
                    "page_size": page_size,
                    "total": 0,
                }
            ),
            502,
        )


@bp.route("/settings")
def backup_settings():
    from app.security import sanitize_error_message

    try:
        data = api_get("/api/admin/settings/backup-storage")
        return jsonify(data if isinstance(data, dict) else {"settings": data})
    except Exception as e:
        msg = sanitize_error_message(e, "backup_settings")
        return jsonify({"error": msg}), 502


@bp.route("/settings", methods=["PUT"])
def update_backup_settings():
    from app.security import sanitize_error_message

    data = request.get_json(silent=True) or {}
    if not data.get("backend"):
        return jsonify({"error": "backend required (local or s3)"}), 400
    try:
        result = api_put("/api/admin/settings/backup-storage", data)
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "update_backup_settings")
        return jsonify({"error": msg}), 502


@bp.route("/settings/test", methods=["POST"])
def test_backup_settings():
    from app.security import sanitize_error_message

    try:
        result = api_post("/api/admin/settings/backup-storage/test")
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "test_backup_settings")
        return jsonify({"error": msg}), 502


@bp.route("/<backup_id>")
def backup_detail(backup_id):
    from app.security import sanitize_error_message

    validate_backup_id(backup_id)

    try:
        data = api_get(f"/api/admin/backups/{backup_id}")
        return jsonify({"backup": data})
    except Exception as e:
        msg = sanitize_error_message(e, "backup_detail")
        return jsonify({"error": msg}), 502


@bp.route("/trigger", methods=["POST"])
def trigger_backup():
    from app.security import sanitize_error_message, validate_resource_id

    data = request.get_json()
    if not data or not data.get("instance_id"):
        return jsonify({"error": "instance_id required"}), 400

    try:
        validate_resource_id(data["instance_id"], "instance")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    kind = data.get("kind", "database")
    if kind not in ("database", "volumes"):
        return jsonify({"error": "kind must be 'database' or 'volumes'"}), 400
    try:
        if kind == "volumes":
            result = api_post(f"/api/admin/instances/{data['instance_id']}/backups/volumes")
        else:
            result = api_post(f"/api/admin/instances/{data['instance_id']}/backups/database")
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "trigger_backup")
        return jsonify({"error": msg}), 502


@bp.route("/prune", methods=["POST"])
def prune_backups():
    from app.security import sanitize_error_message

    try:
        result = api_post("/api/admin/backups/prune")
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "prune_backups")
        return jsonify({"error": msg}), 502


@bp.route("/<backup_id>", methods=["DELETE"])
def delete_backup(backup_id):
    from app.security import sanitize_error_message

    validate_backup_id(backup_id)

    try:
        result = api_delete(f"/api/admin/backups/{backup_id}")
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "delete_backup")
        return jsonify({"error": msg}), 502


@bp.route("/restore", methods=["POST"])
def restore_backup():
    from app.security import sanitize_error_message

    data = request.get_json()
    if not data or not data.get("backup_id") or not data.get("target_app_id"):
        return jsonify({"error": "backup_id and target_app_id required"}), 400
    try:
        validate_backup_id(data["backup_id"])
        validate_resource_id(data["target_app_id"], "target app")
        backup = api_get(f"/api/admin/backups/{data['backup_id']}")
        service = backup.get("service") or backup.get("service_name")
        if not service:
            storage_key = str(backup.get("storage_key") or "")
            # Admirald stores keys as .../<service>-database-<operation> or
            # .../<service>-volumes-<operation>.  The service is the segment
            # before the backup type, not a segment named "database".
            match = re.search(r"/([^/]+)-(?:database|volumes)-[^/]+$", storage_key)
            if match:
                service = match.group(1)
        if not isinstance(service, str) or not service:
            return jsonify({"error": "backup has no restorable service"}), 400
        result = api_post(
            "/api/admin/backups/restore",
            {
                "backup_id": data["backup_id"],
                "target_app_id": data["target_app_id"],
                "service": service,
            },
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        msg = sanitize_error_message(e, "restore_backup")
        return jsonify({"error": msg}), 502
