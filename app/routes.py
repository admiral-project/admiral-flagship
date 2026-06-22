# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import ipaddress
import os
from datetime import datetime, timezone

from flask import Blueprint, render_template, jsonify, request, current_app
from app.admiral_client import api_get

bp = Blueprint("main", __name__, url_prefix="/")


def _ip_allowed():
    addr = request.remote_addr or ""
    allowed_cidrs = os.environ.get(
        "FLAGSHIP_ALLOWED_HEALTH_IPS", "127.0.0.1/32,::1/128,10.99.0.0/16"
    )
    try:
        ip = ipaddress.ip_address(addr)
        for cidr in allowed_cidrs.split(","):
            if ip in ipaddress.ip_network(cidr.strip()):
                return True
    except ValueError:
        pass
    return False


@bp.route("/")
def index():
    return render_template("layout.html")


@bp.route("/flagship/api/health")
def health():
    if not _ip_allowed():
        return jsonify({"status": "forbidden"}), 403
    return jsonify({"status": "healthy"})


@bp.route("/flagship/api/ready")
def ready():
    if not _ip_allowed():
        return jsonify({"status": "forbidden"}), 403
    try:
        api_get("/api/v1/status")
        return jsonify({
            "status": "ok",
            "admirald": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "admirald": "error",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
