# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import logging

from flask import Blueprint, jsonify, request

from app.admiral_client import api_get, api_post
from app.bff.pagination import normalize_page, parse_paging_args
from app.security import validate_resource_id

logger = logging.getLogger("admiral-flagship")

bp = Blueprint("bff_instances", __name__, url_prefix="/flagship/api/instances")


def validate_instance_id(instance_id):
    validate_resource_id(instance_id, "instance")


def normalize_instance(data):
    if isinstance(data, dict):
        if "technical_status" in data and "status" not in data:
            data["status"] = data["technical_status"]
        if "health_status" in data and "health" not in data:
            data["health"] = data["health_status"]
        if "app_definition_name" in data and "app" not in data:
            data["app"] = data["app_definition_name"]
        if "tier_name" in data and "tier" not in data:
            data["tier"] = data["tier_name"]
    return data


@bp.route("")
def list_instances():
    from urllib.parse import urlencode

    from app.security import sanitize_error_message

    page, page_size = parse_paging_args()
    status = request.args.get("status", "").strip()
    customer = request.args.get("customer_id", "").strip()
    app = request.args.get("app_definition_name", "").strip()
    try:
        if customer:
            validate_resource_id(customer, "customer")
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    try:
        params = {"page": page, "page_size": page_size}
        if status:
            params["status"] = status
        if customer:
            params["customer_id"] = customer
        if app:
            params["app_definition_name"] = app

        path = f"/api/admin/instances?{urlencode(params)}"
        data = api_get(path)
        result = normalize_page(data, "instances", page, page_size)
        for item in result.get("items", []):
            normalize_instance(item)
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "list_instances")
        return (
            jsonify(
                {
                    "error": msg,
                    "instances": [],
                    "items": [],
                    "page": page,
                    "page_size": page_size,
                    "total": 0,
                }
            ),
            502,
        )


@bp.route("/<instance_id>")
def instance_detail(instance_id):
    from app.security import sanitize_error_message

    validate_instance_id(instance_id)

    try:
        data = api_get(f"/api/admin/instances/{instance_id}")
        normalize_instance(data)
        return jsonify(data)
    except Exception as e:
        msg = sanitize_error_message(e, "instance_detail")
        return jsonify({"error": msg}), 502


@bp.route("/<instance_id>/credentials")
def credentials(instance_id):
    from app.security import sanitize_error_message

    validate_instance_id(instance_id)

    try:
        data = api_get(f"/api/v1/customer-apps/{instance_id}/credentials")
        return jsonify(data if isinstance(data, list) else [])
    except Exception as e:
        msg = sanitize_error_message(e, "credentials")
        return jsonify({"error": msg, "credentials": []}), 502


@bp.route("/<instance_id>/tiers")
def instance_tiers(instance_id):
    from app.security import sanitize_error_message

    validate_instance_id(instance_id)

    try:
        instance = api_get(f"/api/admin/instances/{instance_id}")
        app_id = instance.get("app_id") or instance.get("app") or instance.get("app_definition_name")
        if not app_id:
            return jsonify({"error": "instance has no app reference", "tiers": []}), 404
        tiers = api_get(f"/api/admin/apps/{app_id}/tiers")
        return jsonify(
            {
                "tiers": tiers if isinstance(tiers, list) else [],
                "current_tier": instance.get("tier_id") or instance.get("tier"),
            }
        )
    except Exception as e:
        msg = sanitize_error_message(e, "instance_tiers")
        return jsonify({"error": msg, "tiers": []}), 502


@bp.route("/<instance_id>/operations")
def instance_operations(instance_id):
    from app.security import sanitize_error_message

    validate_instance_id(instance_id)

    try:
        data = api_get("/api/admin/tasks")
        items = data if isinstance(data, list) else data.get("items") or data.get("data") or []
        related = [op for op in items if op.get("instance_id") == instance_id or op.get("instance") == instance_id]
        return jsonify({"operations": related[:20]})
    except Exception as e:
        msg = sanitize_error_message(e, "instance_operations")
        return jsonify({"error": msg, "operations": []}), 502


ALLOWED_INSTANCE_ACTIONS = frozenset(
    {
        "pause",
        "resume",
        "restart",
        "inspect",
        "deprovision",
        "start",
        "stop",
        "resize",
    }
)


@bp.route("/<instance_id>/action", methods=["POST"])
def instance_action(instance_id):
    from app.security import sanitize_error_message

    validate_instance_id(instance_id)

    data = request.get_json()
    if not data or not data.get("action"):
        return jsonify({"error": "action is required"}), 400

    action = data["action"]
    if action not in ALLOWED_INSTANCE_ACTIONS:
        return jsonify({"error": f"action {action!r} is not allowed"}), 400
    if action == "resize" and not isinstance(data.get("tier"), str):
        return jsonify({"error": "tier is required for resize"}), 400

    try:
        result = api_post(f"/api/admin/instances/{instance_id}/{action}", data)
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "instance_action")
        return jsonify({"error": msg}), 502


@bp.route("/<instance_id>/migrate", methods=["POST"])
def migrate_instance(instance_id):
    from app.security import sanitize_error_message

    validate_instance_id(instance_id)

    data = request.get_json(silent=True) or {}
    node_id = (data.get("node_id") or data.get("target_node_id") or "").strip()
    if not node_id:
        return jsonify({"error": "node_id required"}), 400
    try:
        validate_resource_id(node_id, "node")
        result = api_post(
            f"/api/admin/instances/{instance_id}/migrate",
            {
                "target_node_id": node_id,
            },
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        msg = sanitize_error_message(e, "migrate_instance")
        return jsonify({"error": msg}), 502


@bp.route("/provision", methods=["POST"])
def provision_instance():
    from app.security import sanitize_error_message

    data = request.get_json(silent=True) or {}
    required = ["app_definition_name", "tier_name", "customer_id"]
    missing = [key for key in required if not data.get(key)]
    if missing:
        return jsonify({"error": ", ".join(missing) + " required"}), 400
    try:
        validate_resource_id(data["customer_id"], "customer")
        body = {
            "app_definition_name": data["app_definition_name"],
            "tier_name": data["tier_name"],
            "customer_id": data["customer_id"],
        }
        if data.get("logical_instance_id"):
            validate_resource_id(data["logical_instance_id"], "logical instance")
            body["logical_instance_id"] = data["logical_instance_id"]
        node_id = (data.get("node_id") or data.get("target_node_id") or "").strip()
        if node_id:
            validate_resource_id(node_id, "node")
            body["node_id"] = node_id
        result = api_post("/api/v1/customer-apps", body)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        msg = sanitize_error_message(e, "provision_instance")
        return jsonify({"error": msg}), 502
