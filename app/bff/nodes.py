# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

from flask import Blueprint, jsonify, request
from app.admiral_client import api_get, api_post
from app.bff.pagination import normalize_page, parse_paging_args, paginate_items

bp = Blueprint("bff_nodes", __name__, url_prefix="/flagship/api/nodes")


@bp.route("")
def list_nodes():
    from app.security import sanitize_error_message

    page, page_size = parse_paging_args()
    status = request.args.get("status", "").strip().lower()
    try:
        data = api_get("/api/admin/nodes")
        payload = normalize_page(data, "nodes", 1, 1000)
        items = payload["items"]
        if status:
            items = [
                node for node in items if str(node.get("status", "")).lower() == status
            ]
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
        data = api_post("/api/v1/nodes", body)
        return jsonify(data)
    except Exception as e:
        msg = sanitize_error_message(e, "register_node")
        return jsonify({"error": msg}), 502


@bp.route("/<node_id>")
def node_detail(node_id):
    from app.security import sanitize_error_message

    try:
        node = api_get(f"/api/admin/nodes/{node_id}")
        try:
            metrics = api_get(f"/api/admin/nodes/{node_id}/metrics")
        except Exception:
            metrics = None
        return jsonify({"node": node, "metrics": metrics})
    except Exception as e:
        msg = sanitize_error_message(e, "node_detail")
        return jsonify({"error": msg}), 502


@bp.route("/<node_id>/disable", methods=["POST"])
def disable_node(node_id):
    from app.security import sanitize_error_message

    try:
        data = api_post(f"/api/admin/nodes/{node_id}/disable")
        return jsonify(data)
    except Exception as e:
        msg = sanitize_error_message(e, "disable_node")
        return jsonify({"error": msg}), 502


@bp.route("/<node_id>/enable", methods=["POST"])
def enable_node(node_id):
    from app.security import sanitize_error_message

    try:
        data = api_post(f"/api/admin/nodes/{node_id}/enable")
        return jsonify(data)
    except Exception as e:
        msg = sanitize_error_message(e, "enable_node")
        return jsonify({"error": msg}), 502
