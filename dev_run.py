# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

"""
admiral-flagship dev mode — runs mock admirald API + real flagship app.

Starts two servers on different ports:
  - Mock admirald API  → http://127.0.0.1:18099
  - Real flagship app  → http://127.0.0.1:5000

Flagship's BFF talks to the mock API, so no real backend setup needed.

Usage:
    python dev_run.py
"""

import os
import sys
import uuid
import time
import logging
import re
import threading
from datetime import datetime, timedelta

from flask import Flask, request, jsonify, abort

# ── Configuration ──────────────────────────────────────────────────────────

HOST = os.environ.get("ADMIRAL_MOCK_HOST", "127.0.0.1")
MOCK_PORT = int(os.environ.get("ADMIRAL_MOCK_PORT", "18099"))
FLAGSHIP_HOST = os.environ.get("FLAGSHIP_HTTP_ADDR", "127.0.0.1")
FLAGSHIP_PORT = int(os.environ.get("FLAGSHIP_HTTP_PORT", "5000"))
DEBUG = os.environ.get("DEV_RUN_DEBUG", "0") == "1"
SHARED_TOKEN = os.environ.get("ADMIRAL_SHARED_TOKEN", "dev-token")

logging.basicConfig(
    level=logging.DEBUG if DEBUG else logging.INFO,
    format="[admirald-mock] %(levelname)s %(message)s",
)
log = logging.getLogger("admirald-mock")

# ── Mock App Factory ───────────────────────────────────────────────────────

mock_app = Flask("admirald-mock")

# ── Mock Data ──────────────────────────────────────────────────────────────

NOW = datetime.utcnow()

NODES = [
    {"id": "n1", "hostname": "node-01.lan", "status": "online", "ip": "10.0.0.10", "cpu": 8, "memory": 34359738368, "memory_used": 15032385536, "disk": 536870912000, "disk_used": 128849018880, "os": "Fedora 40", "podman_version": "5.0.0", "region": "us-east", "created_at": "2026-01-15T08:00:00Z", "updated_at": (NOW - timedelta(minutes=5)).isoformat() + "Z"},
    {"id": "n2", "hostname": "node-02.lan", "status": "online", "ip": "10.0.0.11", "cpu": 16, "memory": 68719476736, "memory_used": 30064771072, "disk": 1099511627776, "disk_used": 365072220160, "os": "Fedora 40", "podman_version": "5.0.0", "region": "us-east", "created_at": "2026-02-01T10:00:00Z", "updated_at": (NOW - timedelta(minutes=2)).isoformat() + "Z"},
    {"id": "n3", "hostname": "node-03.lan", "status": "offline", "ip": "10.0.0.12", "cpu": 8, "memory": 34359738368, "memory_used": 0, "disk": 536870912000, "disk_used": 96636764160, "os": "Fedora 39", "podman_version": "4.9.0", "region": "eu-central", "created_at": "2026-03-10T12:00:00Z", "updated_at": (NOW - timedelta(hours=48)).isoformat() + "Z"},
    {"id": "n4", "hostname": "node-04.lan", "status": "online", "ip": "10.0.0.13", "cpu": 32, "memory": 137438953472, "memory_used": 60129542144, "disk": 2199023255552, "disk_used": 837518622720, "os": "Fedora 40", "podman_version": "5.0.0", "region": "us-west", "created_at": "2026-04-05T14:00:00Z", "updated_at": (NOW - timedelta(minutes=1)).isoformat() + "Z"},
]

APPS = [
    {"id": "app-whoami", "name": "whoami", "description": "Lightweight HTTP echo server for testing and health checks", "version": "1.0.0", "status": "active", "created_at": "2026-01-01T00:00:00Z"},
    {"id": "app-blog", "name": "ghost", "description": "Professional publishing platform for content creators", "version": "5.0.0", "status": "active", "created_at": "2026-01-01T00:00:00Z"},
    {"id": "app-crm", "name": "twenty-crm", "description": "Open source customer relationship management", "version": "0.30.0", "status": "active", "created_at": "2026-01-15T00:00:00Z"},
    {"id": "app-n8n", "name": "n8n", "description": "Workflow automation with visual builder", "version": "1.0.0", "status": "active", "created_at": "2026-02-01T00:00:00Z"},
]

APP_TIERS = {
    "app-whoami": [
        {"name": "starter", "cpu": "0.5", "memory": 536870912, "storage": 5368709120, "price_monthly": 9.99, "description": "For small experiments"},
        {"name": "business", "cpu": "2", "memory": 4294967296, "storage": 21474836480, "price_monthly": 29.99, "description": "For production apps"},
    ],
}

INSTANCES = [
    {"id": "i_a1b2c3d4", "app_id": "app-whoami", "app_definition_name": "whoami", "tier_id": "tier-starter", "tier_name": "starter", "customer_id": "client1", "status": "running", "health": "healthy", "node_id": "n1", "url": "https://whoami.client1.admiral.bmogroup.solutions", "created_at": (NOW - timedelta(days=45)).isoformat() + "Z", "updated_at": (NOW - timedelta(hours=2)).isoformat() + "Z"},
    {"id": "i_e5f6g7h8", "app_id": "app-blog", "app_definition_name": "ghost", "tier_id": "tier-business", "tier_name": "business", "customer_id": "client1", "status": "running", "health": "healthy", "node_id": "n2", "url": "https://blog.client1.admiral.bmogroup.solutions", "created_at": (NOW - timedelta(days=30)).isoformat() + "Z", "updated_at": (NOW - timedelta(hours=12)).isoformat() + "Z"},
    {"id": "i_i9j0k1l2", "app_id": "app-crm", "app_definition_name": "twenty-crm", "tier_id": "tier-enterprise", "tier_name": "enterprise", "customer_id": "client2", "status": "paused", "health": "degraded", "node_id": "n2", "url": "https://crm.client2.admiral.bmogroup.solutions", "created_at": (NOW - timedelta(days=20)).isoformat() + "Z", "updated_at": (NOW - timedelta(days=3)).isoformat() + "Z"},
    {"id": "i_m3n4o5p6", "app_id": "app-n8n", "app_definition_name": "n8n", "tier_id": "tier-business", "tier_name": "business", "customer_id": "client3", "status": "running", "health": "healthy", "node_id": "n4", "url": "https://n8n.client3.admiral.bmogroup.solutions", "created_at": (NOW - timedelta(days=10)).isoformat() + "Z", "updated_at": (NOW - timedelta(minutes=30)).isoformat() + "Z"},
    {"id": "i_q7r8s9t0", "app_id": "app-whoami", "app_definition_name": "whoami", "tier_id": "tier-starter", "tier_name": "starter", "customer_id": "client4", "status": "error", "health": "critical", "node_id": "n3", "url": "https://whoami.client4.admiral.bmogroup.solutions", "created_at": (NOW - timedelta(days=60)).isoformat() + "Z", "updated_at": (NOW - timedelta(days=7)).isoformat() + "Z"},
]

BACKUPS = [
    {"id": "bkp_a1", "instance_id": "i_a1b2c3d4", "type": "database", "status": "completed", "size": 47185920, "created_at": (NOW - timedelta(hours=4)).isoformat() + "Z", "completed_at": (NOW - timedelta(hours=3, minutes=55)).isoformat() + "Z"},
    {"id": "bkp_a2", "instance_id": "i_a1b2c3d4", "type": "database", "status": "completed", "size": 46137344, "created_at": (NOW - timedelta(days=1)).isoformat() + "Z", "completed_at": (NOW - timedelta(days=1, hours=0, minutes=-5)).isoformat() + "Z"},
    {"id": "bkp_b1", "instance_id": "i_e5f6g7h8", "type": "database", "status": "completed", "size": 241172480, "created_at": (NOW - timedelta(hours=2)).isoformat() + "Z", "completed_at": (NOW - timedelta(hours=1, minutes=50)).isoformat() + "Z"},
    {"id": "bkp_b2", "instance_id": "i_e5f6g7h8", "type": "full", "status": "completed", "size": 1288490189, "created_at": (NOW - timedelta(days=7)).isoformat() + "Z", "completed_at": (NOW - timedelta(days=7, hours=0, minutes=-10)).isoformat() + "Z"},
    {"id": "bkp_c1", "instance_id": "i_i9j0k1l2", "type": "database", "status": "completed", "size": 933232640, "created_at": (NOW - timedelta(days=14)).isoformat() + "Z", "completed_at": (NOW - timedelta(days=14, hours=0, minutes=-3)).isoformat() + "Z"},
    {"id": "bkp_e1", "instance_id": "i_m3n4o5p6", "type": "database", "status": "failed", "size": 0, "created_at": (NOW - timedelta(hours=1)).isoformat() + "Z", "completed_at": None},
    {"id": "bkp_d1", "instance_id": "i_q7r8s9t0", "type": "database", "status": "running", "size": 0, "created_at": NOW.isoformat() + "Z", "completed_at": None},
]

OPERATIONS = [
    {"id": "op_100", "type": "instance.create", "status": "completed", "instance_id": "i_m3n4o5p6", "node_id": "n4", "created_at": (NOW - timedelta(days=10)).isoformat() + "Z", "updated_at": (NOW - timedelta(days=10, minutes=-5)).isoformat() + "Z", "error_message": ""},
    {"id": "op_99", "type": "backup.create", "status": "completed", "instance_id": "i_e5f6g7h8", "node_id": "n2", "created_at": (NOW - timedelta(hours=2)).isoformat() + "Z", "updated_at": (NOW - timedelta(hours=2, minutes=-2)).isoformat() + "Z", "error_message": ""},
    {"id": "op_98", "type": "instance.pause", "status": "completed", "instance_id": "i_i9j0k1l2", "node_id": "n2", "created_at": (NOW - timedelta(days=3)).isoformat() + "Z", "updated_at": (NOW - timedelta(days=3, minutes=-1)).isoformat() + "Z", "error_message": ""},
    {"id": "op_97", "type": "backup.create", "status": "running", "instance_id": "i_q7r8s9t0", "node_id": "n3", "created_at": NOW.isoformat() + "Z", "updated_at": NOW.isoformat() + "Z", "error_message": ""},
    {"id": "op_96", "type": "instance.deprovision", "status": "failed", "instance_id": "i_deprecated", "node_id": "n3", "created_at": (NOW - timedelta(days=5)).isoformat() + "Z", "updated_at": (NOW - timedelta(days=5)).isoformat() + "Z", "error_message": "node unreachable: connection timeout after 30s"},
]



BACKUP_STORAGE_CONFIG = {
    "backend": "s3",
    "endpoint": "https://s3.us-east-1.amazonaws.com",
    "bucket": "admiral-backups-dev",
    "region": "us-east-1",
    "access_key_id": "AKIA****WXYZ",
    "secret_access_key": "****",
    "status": "configured",
    "last_tested": (NOW - timedelta(days=1)).isoformat() + "Z",
}


def _yaml_value(yaml_text, key):
    match = re.search(rf"(?m)^{re.escape(key)}:\s*(.+)$", yaml_text)
    if not match:
        return ""
    return match.group(1).strip().strip('"').strip("'")

# ── Auth helpers ───────────────────────────────────────────────────────────

_admin_sessions = {}

# ── Request logging ────────────────────────────────────────────────────────

@mock_app.before_request
def _log_request():
    log.debug("%s %s", request.method, request.path)

# ── Health ─────────────────────────────────────────────────────────────────

@mock_app.route("/health")
@mock_app.route("/api/v1/health")
def mock_health():
    return jsonify({"status": "healthy"})

@mock_app.route("/api/v1/status")
def mock_status():
    return jsonify({"status": "healthy", "database": "connected"})

# ── Admin Auth ─────────────────────────────────────────────────────────────

@mock_app.route("/api/admin/auth/login", methods=["POST"])
def mock_admin_login():
    data = request.get_json(silent=True) or {}
    if not data.get("username") or not data.get("password"):
        return jsonify({"error": "username and password required"}), 401
    token = "adm_" + uuid.uuid4().hex[:24]
    _admin_sessions[token] = {
        "username": data["username"],
        "created_at": NOW.isoformat() + "Z",
        "expires_at": (NOW + timedelta(hours=24)).isoformat() + "Z",
    }
    return jsonify({"token": token, "expires_at": _admin_sessions[token]["expires_at"]})

@mock_app.route("/api/admin/auth/logout", methods=["POST"])
def mock_admin_logout():
    token = request.headers.get("X-Admiral-Admin-Token", "")
    _admin_sessions.pop(token, None)
    return jsonify({"success": True})

@mock_app.route("/api/admin/auth/me")
def mock_admin_me():
    token = request.headers.get("X-Admiral-Admin-Token", "")
    session = _admin_sessions.get(token)
    if not session:
        return jsonify({"error": "not authenticated"}), 401
    return jsonify({"username": session["username"], "created_at": session["created_at"]})

@mock_app.route("/api/admin/auth/change-password", methods=["POST"])
def mock_admin_change_password():
    token = request.headers.get("X-Admiral-Admin-Token", "")
    if not _admin_sessions.get(token):
        return jsonify({"error": "not authenticated"}), 401
    data = request.get_json(silent=True) or {}
    if not data.get("current_password") or not data.get("new_password"):
        return jsonify({"error": "current_password and new_password are required"}), 400
    return jsonify({"success": True})

# ── Admin Nodes ────────────────────────────────────────────────────────────

@mock_app.route("/api/admin/nodes")
def mock_admin_nodes_list():
    return jsonify(NODES)

@mock_app.route("/api/admin/nodes/<node_id>")
def mock_admin_node_detail(node_id):
    node = next((n for n in NODES if n["id"] == node_id), None)
    if not node:
        return jsonify({"error": "node not found"}), 404
    return jsonify(node)

@mock_app.route("/api/admin/nodes/<node_id>/metrics")
def mock_admin_node_metrics(node_id):
    node = next((n for n in NODES if n["id"] == node_id), None)
    if not node:
        return jsonify({"error": "node not found"}), 404
    return jsonify({
        "node_id": node_id,
        "cpu_used_percent": round(45 + hash(node_id) % 40, 1),
        "memory_used_percent": round(node["memory_used"] / node["memory"] * 100, 1) if node["memory"] else 0,
        "memory_used_bytes": node["memory_used"],
        "memory_total_bytes": node["memory"],
        "disk_used_percent": round(node["disk_used"] / node["disk"] * 100, 1) if node["disk"] else 0,
        "disk_used_bytes": node["disk_used"],
        "disk_total_bytes": node["disk"],
        "pod_count": 3 + hash(node_id) % 8,
        "collected_at": NOW.isoformat() + "Z",
    })

# ── Admin Apps ─────────────────────────────────────────────────────────────

@mock_app.route("/api/admin/apps", methods=["GET", "POST"])
def mock_admin_apps_list():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        yaml_text = data.get("yaml", "")
        if not yaml_text.strip():
            return jsonify({"error": "yaml is required"}), 400

        name = _yaml_value(yaml_text, "name")
        description = _yaml_value(yaml_text, "description")
        version = _yaml_value(yaml_text, "version")
        display_name = _yaml_value(yaml_text, "display_name") or name
        if not name:
            return jsonify({"error": "name is required in yaml"}), 400

        existing = next((a for a in APPS if a["id"] == name or a["name"] == name), None)
        if existing:
            existing["name"] = name
            existing["id"] = existing.get("id") or name
            existing["description"] = description or existing.get("description", "")
            existing["version"] = version or existing.get("version", "1.0.0")
            existing["display_name"] = display_name
        else:
            APPS.append({
                "id": name,
                "name": name,
                "display_name": display_name,
                "description": description,
                "version": version or "1.0.0",
                "status": "active",
                "created_at": NOW.isoformat() + "Z",
            })
        return jsonify({"success": True, "name": name, "version": version or "1.0.0"})
    return jsonify(APPS)

@mock_app.route("/api/admin/apps/<app_id>")
def mock_admin_app_detail(app_id):
    app = next((a for a in APPS if a["id"] == app_id or a["name"] == app_id), None)
    if not app:
        return jsonify({"error": "app not found"}), 404
    return jsonify(app)

@mock_app.route("/api/admin/apps/<app_id>/yaml")
def mock_admin_app_yaml(app_id):
    app = next((a for a in APPS if a["id"] == app_id or a["name"] == app_id), None)
    if not app:
        return jsonify({"error": "app not found"}), 404
    yaml_content = f"""name: {app["name"]}
description: {app["description"]}
version: {app["version"]}
services:
  web:
    image: docker.io/admiral/{app["name"]}:{app["version"]}
    ports:
      - 8080
    health:
      path: /health
"""
    return yaml_content, 200, {"Content-Type": "application/x-yaml"}


@mock_app.route("/api/admin/apps/<app_id>/status", methods=["PUT"])
def mock_admin_app_status(app_id):
    app = next((a for a in APPS if a["id"] == app_id or a["name"] == app_id), None)
    if not app:
        return jsonify({"error": "app not found"}), 404
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "")).strip().lower()
    if status not in {"active", "inactive"}:
        return jsonify({"error": "status must be active or inactive"}), 400
    app["status"] = status
    return jsonify({"success": True, "name": app.get("name", app_id), "status": status})

@mock_app.route("/api/admin/apps/<app_id>/versions")
def mock_admin_app_versions(app_id):
    return jsonify(["latest"])

@mock_app.route("/api/admin/apps/<app_id>/tiers")
def mock_admin_app_tiers_list(app_id):
    return jsonify(APP_TIERS.get(app_id, []))

@mock_app.route("/api/admin/apps/<app_id>/tiers/<tier_name>")
def mock_admin_app_tier_detail(app_id, tier_name):
    tiers = APP_TIERS.get(app_id, [])
    tier = next((t for t in tiers if t["name"] == tier_name), None)
    if not tier:
        return jsonify({"error": "tier not found"}), 404
    return jsonify(tier)

# ── Admin Instances ────────────────────────────────────────────────────────

@mock_app.route("/api/admin/instances")
def mock_admin_instances_list():
    return jsonify(INSTANCES)

@mock_app.route("/api/admin/instances/<instance_id>")
def mock_admin_instance_detail(instance_id):
    inst = next((i for i in INSTANCES if i["id"] == instance_id), None)
    if not inst:
        return jsonify({"error": "instance not found"}), 404
    app_details = next((a for a in APPS if a["id"] == inst["app_id"]), {})
    inst_backups = [b for b in BACKUPS if b["instance_id"] == instance_id]
    return jsonify({**inst, "app_details": app_details, "backups": inst_backups})

@mock_app.route("/api/admin/instances/<instance_id>/inspect", methods=["POST"])
def mock_admin_instance_inspect(instance_id):
    return jsonify({"operation_id": "op_" + uuid.uuid4().hex[:12], "status": "queued"}), 202

@mock_app.route("/api/admin/instances/<instance_id>/<action>", methods=["POST"])
def mock_admin_instance_action(instance_id, action):
    return jsonify({"operation_id": "op_" + uuid.uuid4().hex[:12], "status": "queued"}), 202

@mock_app.route("/api/admin/instances/<instance_id>/backups/database", methods=["POST"])
def mock_admin_instance_backup_database(instance_id):
    return jsonify({"operation_id": "op_" + uuid.uuid4().hex[:12], "status": "queued"}), 202

@mock_app.route("/api/admin/instances/<instance_id>/backups/volumes", methods=["POST"])
def mock_admin_instance_backup_volumes(instance_id):
    return jsonify({"operation_id": "op_" + uuid.uuid4().hex[:12], "status": "queued"}), 202

# ── Admin Backups ──────────────────────────────────────────────────────────

@mock_app.route("/api/admin/backups")
def mock_admin_backups_list():
    instance_id = request.args.get("instance_id", "")
    result = BACKUPS
    if instance_id:
        result = [b for b in BACKUPS if b["instance_id"] == instance_id]
    return jsonify(result)

@mock_app.route("/api/admin/backups/<backup_id>")
def mock_admin_backup_detail(backup_id):
    backup = next((b for b in BACKUPS if b["id"] == backup_id), None)
    if not backup:
        return jsonify({"error": "backup not found"}), 404
    return jsonify(backup)

@mock_app.route("/api/admin/backups/prune", methods=["POST"])
def mock_admin_backups_prune():
    return jsonify({"success": True, "pruned_backups_count": 2})

@mock_app.route("/api/admin/backups/restore", methods=["POST"])
def mock_admin_backups_restore():
    data = request.get_json(silent=True) or {}
    if not data.get("backup_id") or not data.get("target_app_id"):
        return jsonify({"error": "backup_id and target_app_id required"}), 400
    return jsonify({"operation_id": "op_" + uuid.uuid4().hex[:12], "status": "queued"}), 202

@mock_app.route("/api/admin/backups/<backup_id>", methods=["DELETE"])
def mock_admin_backup_delete(backup_id):
    return jsonify({"operation_id": "op_" + uuid.uuid4().hex[:12], "status": "queued"}), 202

# ── Admin Tasks ────────────────────────────────────────────────────────────

@mock_app.route("/api/admin/tasks")
def mock_admin_tasks_list():
    return jsonify(OPERATIONS)

@mock_app.route("/api/admin/tasks/<task_id>")
def mock_admin_task_detail(task_id):
    task = next((t for t in OPERATIONS if t["id"] == task_id), None)
    if not task:
        return jsonify({"error": "task not found"}), 404
    return jsonify(task)

# ── Admin Settings ─────────────────────────────────────────────────────────

@mock_app.route("/api/admin/settings/backup-storage", methods=["GET"])
def mock_admin_settings_backup_storage_get():
    s = BACKUP_STORAGE_CONFIG.copy()
    s["secret_access_key"] = "****"
    return jsonify(s)

@mock_app.route("/api/admin/settings/backup-storage", methods=["PUT"])
def mock_admin_settings_backup_storage_put():
    return jsonify({"success": True})

@mock_app.route("/api/admin/settings/backup-storage/test", methods=["POST"])
def mock_admin_settings_backup_storage_test():
    return jsonify({"success": True, "operation_id": "op_" + uuid.uuid4().hex[:12]})

# ── V1 Internal API (used by BFF with shared token) ────────────────────────

def _require_shared_token():
    token = request.headers.get("X-Admiral-Token", "")
    if token != SHARED_TOKEN:
        abort(401, description="invalid token")

@mock_app.route("/api/v1/nodes")
def mock_v1_nodes_list():
    _require_shared_token()
    return jsonify(NODES)

@mock_app.route("/api/v1/nodes/<node_id>")
def mock_v1_node_detail(node_id):
    _require_shared_token()
    node = next((n for n in NODES if n["id"] == node_id), None)
    if not node:
        return jsonify({"error": "node not found"}), 404
    return jsonify(node)

@mock_app.route("/api/v1/apps")
def mock_v1_apps_list():
    _require_shared_token()
    return jsonify(APPS)

@mock_app.route("/api/v1/customer-apps")
def mock_v1_customer_apps_list():
    _require_shared_token()
    return jsonify(INSTANCES)

@mock_app.route("/api/v1/customer-apps/<instance_id>")
def mock_v1_customer_app_detail(instance_id):
    _require_shared_token()
    inst = next((i for i in INSTANCES if i["id"] == instance_id), None)
    if not inst:
        return jsonify({"error": "instance not found"}), 404
    return jsonify(inst)

@mock_app.route("/api/v1/customer-apps/action", methods=["POST"])
def mock_v1_customer_app_action():
    _require_shared_token()
    data = request.get_json(silent=True) or {}
    if not data.get("instance_id") or not data.get("action"):
        return jsonify({"error": "instance_id and action required"}), 400
    return jsonify({"operation_id": "op_" + uuid.uuid4().hex[:12], "status": "queued"})

@mock_app.route("/api/v1/backups")
def mock_v1_backups_list():
    _require_shared_token()
    instance_id = request.args.get("instance_id", "")
    result = BACKUPS
    if instance_id:
        result = [b for b in BACKUPS if b["instance_id"] == instance_id]
    return jsonify(result)

@mock_app.route("/api/v1/backups/restore", methods=["POST"])
def mock_v1_backups_restore():
    _require_shared_token()
    return mock_admin_backups_restore()

@mock_app.route("/api/v1/operations")
def mock_v1_operations_list():
    _require_shared_token()
    op_id = request.args.get("id", "")
    if op_id:
        op = next((o for o in OPERATIONS if o["id"] == op_id), None)
        if not op:
            return jsonify({"error": "operation not found"}), 404
        return jsonify(op)
    return jsonify(OPERATIONS)

@mock_app.route("/api/v1/operations/<op_id>")
def mock_v1_operations_detail(op_id):
    _require_shared_token()
    op = next((o for o in OPERATIONS if o["id"] == op_id), None)
    if not op:
        return jsonify({"error": "operation not found"}), 404
    return jsonify(op)

# ── Main ───────────────────────────────────────────────────────────────────

def _print_banner(mock_port, flagship_port):
    print("*" * 60)
    print("  admiral-flagship DEV MODE")
    print("*" * 60)
    print()
    print(f"  Mock admirald API:  http://127.0.0.1:{mock_port}")
    print(f"  Flagship console:   http://127.0.0.1:{flagship_port}")
    print()
    print("  Login:  admin / admin  (or any username/password)")
    print()
    print("  Press Ctrl+C to stop.")
    print("*" * 60)


def _wait_for_mock(host, port, timeout=10):
    import urllib.request
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = urllib.request.urlopen(f"http://{host}:{port}/health", timeout=1)
            if resp.status == 200:
                return True
        except Exception:
            pass
        time.sleep(0.2)
    return False


def main():
    os.environ["ADMIRAL_API_URL"] = f"http://{HOST}:{MOCK_PORT}"
    os.environ.setdefault("ADMIRAL_SHARED_TOKEN", SHARED_TOKEN)
    os.environ.setdefault("FLAGSHIP_SECRET_KEY", "dev-secret-key-change-in-production")

    mock_daemon = threading.Thread(
        target=lambda: mock_app.run(
            host=HOST, port=MOCK_PORT, debug=False, use_reloader=False
        ),
        daemon=True,
    )
    mock_daemon.start()

    if not _wait_for_mock(HOST, MOCK_PORT):
        print("ERROR: mock admirald API did not start in time")
        sys.exit(1)

    from app import create_app
    flagship = create_app()

    _print_banner(MOCK_PORT, FLAGSHIP_PORT)
    flagship.run(host=FLAGSHIP_HOST, port=FLAGSHIP_PORT, debug=DEBUG)


if __name__ == "__main__":
    main()
