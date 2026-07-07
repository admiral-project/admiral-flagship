# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import logging
import os
import time

from flask import Flask, g, request, session, jsonify, redirect, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

from app.log_config import configure_logging
from app.csrf import init_csrf_protection, generate_csrf_token
from app.rate_limit import RateLimiter
from app.security import init_security_headers, validate_production_config


def create_app():
    configure_logging()
    app = Flask(__name__)
    app.config.from_object("app.config.Config")

    # Handle X-Forwarded-For headers if behind a proxy
    # Default to 0 (no trust) for internet-exposed operation
    num_proxies = int(os.environ.get("FLAGSHIP_PROXIES_COUNT", "0"))
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=num_proxies,
        x_proto=num_proxies,
        x_host=num_proxies,
        x_port=num_proxies,
        x_prefix=num_proxies,
    )

    validate_production_config(app.config)

    logger = logging.getLogger("admiral-flagship")
    unauthorized_limiter = RateLimiter(max_attempts=10, window_seconds=300)

    # Initialize security modules
    init_csrf_protection(app)
    init_security_headers(app)

    def wants_json_response():
        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            return True
        best = request.accept_mimetypes.best_match(["application/json", "text/html"])
        return best == "application/json" and (
            request.accept_mimetypes["application/json"] >= request.accept_mimetypes["text/html"]
        )

    def unauthenticated_response(error_message):
        if wants_json_response():
            return jsonify({"error": "unauthorized"}), 401
        return redirect(url_for("main.index"))

    def blocked_response():
        if wants_json_response():
            return jsonify({"error": "too many authentication failures"}), 429
        return redirect(url_for("main.index"))

    @app.before_request
    def before_request():
        g.start_time = time.time()

        # Protect all BFF endpoints under /flagship/api/
        if request.path.startswith("/flagship/api/"):
            # Exclude public endpoints
            public_endpoints = [
                "/flagship/api/health",
                "/flagship/api/ready",
                "/flagship/api/auth/login",
                "/flagship/api/auth/me",
            ]
            if request.path in public_endpoints:
                return None

            # Exclude change-password if no token in session (first-time login password change)
            if request.path == "/flagship/api/auth/change-password" and "admin_token" not in session:
                return None

            # Verify active session
            token = session.get("admin_token")
            username = session.get("admin_username", "unknown")
            ip = request.remote_addr or "unknown"
            limiter_key = f"unauth-bff:{ip}"
            if not token:
                allowed, remaining = unauthorized_limiter.is_allowed(limiter_key)
                if not allowed:
                    logger.warning(
                        "bff ip temporarily blocked after repeated unauthorized access",
                        extra={
                            "path": request.path,
                            "ip": ip,
                            "remaining_seconds": remaining,
                        },
                    )
                    return blocked_response()
                logger.warning(
                    "unauthorized bff access attempt blocked",
                    extra={"path": request.path, "ip": ip},
                )
                return unauthenticated_response("not authenticated")

            # Check local inactivity timeout
            from app.auth import _session_is_expired, _session_absolute_expired, SESSION_STARTED_AT_KEY

            if _session_is_expired():
                session.clear()
                logger.warning(
                    "admin session expired by inactivity timeout",
                    extra={"username": username},
                )
                return unauthenticated_response("session expired")

            if _session_absolute_expired():
                session.clear()
                logger.warning(
                    "admin session expired by absolute timeout",
                    extra={"username": username},
                )
                return unauthenticated_response("session expired")

            # Reset the sliding inactivity window
            session[SESSION_STARTED_AT_KEY] = int(time.time())
            unauthorized_limiter.reset(limiter_key)

    @app.errorhandler(ValueError)
    def handle_value_error(error):
        from app.security import sanitize_error_message

        msg = sanitize_error_message(error)
        if wants_json_response():
            return jsonify({"error": msg}), 400
        return unauthenticated_response(msg)

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
