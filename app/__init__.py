# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import logging
import time

from flask import Flask, g, request, session, jsonify, redirect, url_for

from app.log_config import configure_logging
from app.csrf import init_csrf_protection, generate_csrf_token
from app.security import init_security_headers, validate_production_config


def create_app():
    configure_logging()
    app = Flask(__name__)
    app.config.from_object("app.config.Config")
    validate_production_config(app.config)

    logger = logging.getLogger("admiral-flagship")

    # Initialize security modules
    init_csrf_protection(app)
    init_security_headers(app)

    def wants_json_response():
        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            return True
        best = request.accept_mimetypes.best_match(["application/json", "text/html"])
        return best == "application/json" and (
            request.accept_mimetypes["application/json"]
            >= request.accept_mimetypes["text/html"]
        )

    def unauthenticated_response(error_message):
        if wants_json_response():
            return jsonify({"error": error_message}), 401
        return redirect(url_for("main.index"))

    @app.before_request
    def before_request():
        g.start_time = time.time()

        # Protect all BFF endpoints under /flagship/api/
        if request.path.startswith("/flagship/api/"):
            # Exclude public endpoints
            public_endpoints = [
                "/flagship/api/health",
                "/flagship/api/auth/login",
                "/flagship/api/auth/me",
            ]
            if request.path in public_endpoints:
                return None

            # Exclude change-password if no token in session (first-time login password change)
            if (
                request.path == "/flagship/api/auth/change-password"
                and "admin_token" not in session
            ):
                return None

            # Verify active session
            token = session.get("admin_token")
            username = session.get("admin_username", "unknown")
            if not token:
                logger.warning(
                    "unauthorized bff access attempt blocked",
                    extra={"path": request.path, "ip": request.remote_addr},
                )
                return unauthenticated_response("not authenticated")

            # Check local inactivity timeout
            from app.auth import _session_is_expired, SESSION_STARTED_AT_KEY

            if _session_is_expired():
                session.clear()
                logger.warning(
                    "admin session expired by inactivity timeout",
                    extra={"username": username},
                )
                return unauthenticated_response("session expired")

            # Reset the sliding inactivity window
            session[SESSION_STARTED_AT_KEY] = int(time.time())

    @app.after_request
    def after_request(response):
        # If an unauthenticated backend call was flagged, return 401
        if g.get("unauthorized_backend_call"):
            session.clear()
            response = app.make_response(unauthenticated_response("session expired"))

        duration = time.time() - g.get("start_time", time.time())
        logger.info(
            "request completed",
            extra={
                "method": request.method,
                "path": request.path,
                "status": response.status_code,
                "duration_ms": round(duration * 1000, 2),
            },
        )
        return response

    @app.context_processor
    def inject_csrf_token():
        """Make CSRF token available in templates."""
        return dict(csrf_token=generate_csrf_token)

    from app.routes import bp as main_bp
    from app.auth import bp as auth_bp
    from app.bff.dashboard import bp as dashboard_bp
    from app.bff.nodes import bp as nodes_bp
    from app.bff.catalog import bp as catalog_bp
    from app.bff.instances import bp as instances_bp
    from app.bff.backups import bp as backups_bp
    from app.bff.jobs import bp as jobs_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(nodes_bp)
    app.register_blueprint(catalog_bp)
    app.register_blueprint(instances_bp)
    app.register_blueprint(backups_bp)
    app.register_blueprint(jobs_bp)

    logger.info("Admiral Flagship started")
    return app
