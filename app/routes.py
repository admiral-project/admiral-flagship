# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

from flask import Blueprint, render_template, jsonify

bp = Blueprint("main", __name__, url_prefix="/")

@bp.route("/")
def index():
    return render_template("layout.html")

@bp.route("/flagship/api/health")
def health():
    return jsonify({"status": "healthy"})
