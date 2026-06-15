# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

from datetime import datetime, timezone

from flask import Blueprint, jsonify

from app.admiral_client import api_get

bp = Blueprint("bff_dashboard", __name__, url_prefix="/flagship/api/dashboard")


def _as_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        if isinstance(value.get("items"), list):
            return value["items"]
        if isinstance(value.get("data"), list):
            return value["data"]
    return []


def _safe_int(value):
    if isinstance(value, (int, float)):
        return int(value)
    return 0


def _status_lower(item):
    if isinstance(item, dict):
        return str(item.get("status") or item.get("technical_status") or "").lower()
    return ""


def _first(item, *keys, default=""):
    if not isinstance(item, dict):
        return default
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return value
    return default


def _parse_datetime(value):
    if not value or not isinstance(value, str):
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _sort_datetime(item):
    for key in ("updated_at", "updated", "completed_at", "created_at", "created", "timestamp"):
        parsed = _parse_datetime(_first(item, key))
        if parsed is not None:
            return parsed
    return datetime.min.replace(tzinfo=timezone.utc)


def _duration_seconds(item):
    explicit = _first(item, "duration_seconds", "duration_secs", "duration")
    if isinstance(explicit, (int, float)):
        return int(explicit)
    started = _parse_datetime(_first(item, "started_at", "created_at", "created", "timestamp"))
    ended = _parse_datetime(_first(item, "finished_at", "updated_at", "updated", "completed_at"))
    if started is None or ended is None:
        return None
    return max(0, int((ended - started).total_seconds()))


def _progress_percent(item):
    for key in ("progress_percent", "progress", "percent_complete"):
        value = item.get(key) if isinstance(item, dict) else None
        if isinstance(value, (int, float)):
            return max(0, min(100, int(value)))
    return None


def _instance_status_summary(instances):
    counts = {
        "running_instances": 0,
        "paused_instances": 0,
        "stopped_instances": 0,
        "error_instances": 0,
        "past_due_instances": 0,
        "suspended_instances": 0,
        "deprovisioned_instances": 0,
    }
    for item in instances:
        status = _status_lower(item)
        if status == "running":
            counts["running_instances"] += 1
        elif status == "paused":
            counts["paused_instances"] += 1
        elif status in ("stopped", "deprovisioned"):
            counts["stopped_instances"] += 1
            if status == "deprovisioned":
                counts["deprovisioned_instances"] += 1
        elif status in ("error", "failed"):
            counts["error_instances"] += 1
        elif status == "past_due":
            counts["past_due_instances"] += 1
        elif status == "suspended":
            counts["suspended_instances"] += 1
    return counts


@bp.route("")
def dashboard():
    from app.security import sanitize_error_message
    
    try:
        nodes = _as_list(api_get("/api/admin/nodes"))
    except Exception as exc:
        msg = sanitize_error_message(exc, "dashboard.nodes")
        return jsonify({"error": msg, "nodes": [], "instances": [], "jobs": [], "backups": []}), 502

    try:
        instances = _as_list(api_get("/api/admin/instances"))
    except Exception as exc:
        msg = sanitize_error_message(exc, "dashboard.instances")
        return jsonify({"error": msg, "nodes": nodes, "instances": [], "jobs": [], "backups": []}), 502

    for inst in instances:
        if isinstance(inst, dict):
            if "technical_status" in inst and not inst.get("status"):
                inst["status"] = inst["technical_status"]
            if "health_status" in inst and not inst.get("health"):
                inst["health"] = inst["health_status"]
            if "app_definition_name" in inst and not inst.get("app"):
                inst["app"] = inst["app_definition_name"]

    try:
        jobs = _as_list(api_get("/api/admin/tasks"))
    except Exception as exc:
        msg = sanitize_error_message(exc, "dashboard.tasks")
        return jsonify({"error": msg, "nodes": nodes, "instances": instances, "jobs": [], "backups": []}), 502

    try:
        backups = _as_list(api_get("/api/admin/backups"))
    except Exception as exc:
        msg = sanitize_error_message(exc, "dashboard.backups")
        return jsonify({"error": msg, "nodes": nodes, "instances": instances, "jobs": jobs, "backups": []}), 502

    total_ram = sum(_safe_int(node.get("ram_total_bytes")) for node in nodes)
    committed_ram = sum(_safe_int(node.get("committed_ram_bytes")) for node in nodes)
    total_disk = sum(_safe_int(node.get("disk_total_bytes")) for node in nodes)
    committed_disk = sum(_safe_int(node.get("committed_disk_bytes")) for node in nodes)

    offline_nodes = [node for node in nodes if _status_lower(node) in ("offline", "unreachable", "down")]
    active_nodes = [node for node in nodes if _status_lower(node) not in ("offline", "unreachable", "down")]
    failed_jobs = [job for job in jobs if _status_lower(job) in ("failed", "error", "cancelled")]
    failed_backups = [backup for backup in backups if _status_lower(backup) in ("failed", "error")]

    instance_summary = _instance_status_summary(instances)
    error_instances = [
        instance
        for instance in instances
        if _status_lower(instance) in ("error", "failed")
    ]

    degraded_nodes = [
        node for node in nodes
        if node.get("health_status") == "degraded"
        and _status_lower(node) not in ("offline", "unreachable", "down")
    ]

    alerts = []
    if offline_nodes:
        alerts.append(
            {
                "severity": "danger",
                "title": "Node availability",
                "message": f"{len(offline_nodes)} node(s) offline",
                "target": "/nodes?status=offline",
            }
        )
    if degraded_nodes:
        alerts.append(
            {
                "severity": "warning",
                "title": "Node health",
                "message": f"{len(degraded_nodes)} node(s) degraded",
                "target": "/nodes",
            }
        )
    if error_instances:
        alerts.append(
            {
                "severity": "danger",
                "title": "Instance failures",
                "message": f"{len(error_instances)} instance(s) in error",
                "target": "/instances?status=error",
            }
        )
    if instance_summary["past_due_instances"]:
        alerts.append(
            {
                "severity": "warning",
                "title": "Billing attention",
                "message": f"{instance_summary['past_due_instances']} instance(s) past due",
                "target": "/instances?status=past_due",
            }
        )
    if failed_jobs:
        alerts.append(
            {
                "severity": "warning",
                "title": "Failed jobs",
                "message": f"{len(failed_jobs)} failed job(s)",
                "target": "/jobs?status=failed",
            }
        )
    if failed_backups:
        alerts.append(
            {
                "severity": "warning",
                "title": "Failed backups",
                "message": f"{len(failed_backups)} failed backup(s)",
                "target": "/backups",
            }
        )

    recent_jobs = []
    for job in sorted(jobs, key=_sort_datetime, reverse=True)[:6]:
        recent_jobs.append(
            {
                **job,
                "detail_path": f"/jobs/{_first(job, 'id', 'operation_id')}",
                "duration_seconds": _duration_seconds(job),
                "progress_percent": _progress_percent(job),
                "can_retry": bool(job.get("can_retry") or job.get("retry_supported")),
                "can_view_logs": bool(job.get("log_available") or job.get("log_url") or job.get("error_message")),
            }
        )

    recent_failed_backups = []
    for backup in sorted(failed_backups, key=_sort_datetime, reverse=True)[:5]:
        recent_failed_backups.append(
            {
                **backup,
                "detail_path": f"/backups/{_first(backup, 'id', 'backup_id')}",
            }
        )

    return jsonify(
        {
            "nodes": nodes,
            "instances": instances,
            "jobs": jobs,
            "backups": backups,
            "capacity": {
                "total_ram_bytes": total_ram,
                "committed_ram_bytes": committed_ram,
                "total_disk_bytes": total_disk,
                "committed_disk_bytes": committed_disk,
            },
            "alerts": alerts,
            "recent_jobs": recent_jobs,
            "recent_failed_backups": recent_failed_backups,
            "summary": {
                "total_nodes": len(nodes),
                "active_nodes": len(active_nodes),
                "offline_nodes": len(offline_nodes),
                "total_instances": len(instances),
                "jobs": len(jobs),
                "backups": len(backups),
                "failed_jobs": len(failed_jobs),
                "failed_backups": len(failed_backups),
                **instance_summary,
            },
        }
    )
