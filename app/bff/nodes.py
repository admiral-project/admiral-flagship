# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import logging
import ipaddress
import re

from flask import Blueprint, jsonify, request
from app.admiral_client import api_get, api_post, api_delete
from app.bff.pagination import normalize_page, parse_paging_args, paginate_items
from app.security import validate_resource_id

bp = Blueprint("bff_nodes", __name__, url_prefix="/flagship/api/nodes")
logger = logging.getLogger("admiral-flagship")
_HOSTNAME_RE = re.compile(
    r"^(?=.{1,253}$)(?!-)"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"
)


def validate_node_id(node_id):
    validate_resource_id(node_id, "node")


@bp.route("")
def list_nodes():
    from app.security import sanitize_error_message

    page, page_size = parse_paging_args()
    status = request.args.get("status", "").strip().lower()
    node_role = request.args.get("node_role", "").strip().lower()
    try:
        data = api_get("/api/admin/nodes")
        payload = normalize_page(data, "nodes", 1, 1000)
        items = payload["items"]
        if status:
            items = [node for node in items if str(node.get("status", "")).lower() == status]
        if node_role:
            items = [node for node in items if str(node.get("node_role", "")).lower() == node_role]
        result = paginate_items(items, page, page_size)
        result["nodes"] = result["items"]
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "list_nodes")
        return (
            jsonify(
                {
                    "error": msg,
                    "nodes": [],
                    "items": [],
                    "page": page,
                    "page_size": page_size,
                    "total": 0,
                }
            ),
            502,
        )


@bp.route("/register", methods=["POST"])
def register_node():
    from app.security import sanitize_error_message

    body = request.get_json(force=True, silent=True) or {}
    node_id = body.get("node_id", "").strip()
    hostname = body.get("hostname", "").strip()
    ip = body.get("ip", "").strip()
    if not node_id or not hostname or not ip:
        return jsonify({"error": "node_id, hostname, and ip are required"}), 400
    try:
        validate_node_id(node_id)
        ipaddress.ip_address(ip)
        if not _HOSTNAME_RE.fullmatch(hostname):
            raise ValueError("invalid hostname")
        payload = {
            "node_id": node_id,
            "hostname": hostname,
            "ip": ip,
        }
        data = api_post("/api/v1/nodes", payload)
        return jsonify(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        msg = sanitize_error_message(e, "register_node")
        return jsonify({"error": msg}), 502


@bp.route("/<node_id>")
def node_detail(node_id):
    from app.security import sanitize_error_message

    validate_node_id(node_id)

    try:
        node = api_get(f"/api/admin/nodes/{node_id}")
        try:
            metrics = api_get(f"/api/admin/nodes/{node_id}/metrics")
        except Exception as exc:
            logger.warning(
                "Unable to retrieve node metrics",
                extra={"node_id": node_id, "context": "node_detail.metrics", "error": str(exc)},
            )
            metrics = None
        return jsonify({"node": node, "metrics": metrics})
    except Exception as e:
        msg = sanitize_error_message(e, "node_detail")
        return jsonify({"error": msg}), 502


@bp.route("/<node_id>/disable", methods=["POST"])
def disable_node(node_id):
    from app.security import sanitize_error_message

    validate_node_id(node_id)

    try:
        data = api_post(f"/api/admin/nodes/{node_id}/disable")
        return jsonify(data)
    except Exception as e:
        msg = sanitize_error_message(e, "disable_node")
        return jsonify({"error": msg}), 502


@bp.route("/<node_id>/enable", methods=["POST"])
def enable_node(node_id):
    from app.security import sanitize_error_message

    validate_node_id(node_id)

    try:
        data = api_post(f"/api/admin/nodes/{node_id}/enable")
        return jsonify(data)
    except Exception as e:
        msg = sanitize_error_message(e, "enable_node")
        return jsonify({"error": msg}), 502


@bp.route("/<node_id>", methods=["DELETE"])
def remove_node(node_id):
    from app.security import sanitize_error_message

    validate_node_id(node_id)

    try:
        data = api_delete(f"/api/v1/nodes/{node_id}")
        return jsonify(data)
    except Exception as e:
        msg = sanitize_error_message(e, "remove_node")
        status = 502
        if "has active instance" in str(e).lower():
            status = 409
        return jsonify({"error": msg}), status
