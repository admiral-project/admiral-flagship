# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

from flask import Blueprint, jsonify, request
from app.admiral_client import api_get
from app.bff.pagination import normalize_page, parse_paging_args, paginate_items
from app.security import validate_resource_id

bp = Blueprint("bff_jobs", __name__, url_prefix="/flagship/api/jobs")


def validate_job_id(job_id):
    validate_resource_id(job_id, "job")


@bp.route("")
def list_jobs():
    from app.security import sanitize_error_message

    page, page_size = parse_paging_args()
    status = request.args.get("status", "").strip().lower()
    try:
        data = api_get("/api/admin/tasks")
        payload = normalize_page(data, "jobs", 1, 1000)
        items = payload["items"]
        if status:
            items = [
                job for job in items if str(job.get("status", "")).lower() == status
            ]
        result = paginate_items(items, page, page_size)
        result["jobs"] = result["items"]
        return jsonify(result)
    except Exception as e:
        msg = sanitize_error_message(e, "list_jobs")
        return (
            jsonify(
                {
                    "error": msg,
                    "jobs": [],
                    "items": [],
                    "page": page,
                    "page_size": page_size,
                    "total": 0,
                }
            ),
            502,
        )


@bp.route("/<job_id>")
def job_detail(job_id):
    from app.security import sanitize_error_message
    validate_job_id(job_id)

    try:
        data = api_get(f"/api/admin/tasks/{job_id}")
        return jsonify(data)
    except Exception as e:
        msg = sanitize_error_message(e, "job_detail")
        return jsonify({"error": msg}), 502
