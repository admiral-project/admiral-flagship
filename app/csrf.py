# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

"""
Simple CSRF protection without external dependencies.
Generates and validates CSRF tokens stored in session.
"""

import os
import hmac
from functools import wraps
from flask import session, request, jsonify


def _generate_token():
    """Generate a secure random CSRF token."""
    return os.urandom(32).hex()


def generate_csrf_token():
    """Generate and store CSRF token in session. Call this on form pages."""
    if "csrf_token" not in session:
        session["csrf_token"] = _generate_token()
    return session["csrf_token"]


def init_csrf_protection(app):
    """Initialize CSRF protection on the Flask app."""

    @app.before_request
    def csrf_protect():
        """Validate CSRF token on state-changing requests."""
        # Skip CSRF check in test mode
        if app.config.get("TESTING"):
            return None

        # Skip CSRF check for safe methods
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return None

        # Skip CSRF check for public endpoints (login from form is POST)
        public_post_endpoints = [
            "/flagship/api/auth/login",
        ]

        if request.path in public_post_endpoints:
            # These endpoints handle their own validation via credentials
            return None

        # Skip if not an API endpoint
        if not request.path.startswith("/flagship/api/"):
            return None

        # For JSON API requests, accept token via:
        # 1. X-CSRF-Token header
        # 2. csrf_token in JSON body
        token = None

        if request.is_json:
            data = request.get_json(silent=True) or {}
            token = data.get("csrf_token") or request.headers.get("X-CSRF-Token")
        else:
            # Form data or query string
            token = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")

        if not token:
            return jsonify({"error": "CSRF token missing"}), 403

        session_token = session.get("csrf_token")
        if not session_token:
            return jsonify({"error": "Session invalid"}), 401

        # Compare tokens using constant-time comparison
        if not hmac.compare_digest(token, session_token):
            return jsonify({"error": "CSRF token invalid"}), 403

        # Rotate token after successful validation
        session["csrf_token"] = _generate_token()
        return None

    @app.after_request
    def expose_csrf_token(response):
        """Expose current CSRF token in response header for SPA to update."""
        token = session.get("csrf_token")
        if token:
            response.headers["X-CSRF-Token"] = token
        return response

    @app.template_global()
    def csrf_token():
        """Expose CSRF token generation to templates."""
        return generate_csrf_token()


def require_csrf_token(f):
    """Decorator to explicitly require CSRF token for an endpoint."""

    @wraps(f)
    def decorated_function(*args, **kwargs):
        # This is redundant with init_csrf_protection but explicit for security
        token = None

        if request.is_json:
            data = request.get_json(silent=True) or {}
            token = data.get("csrf_token") or request.headers.get("X-CSRF-Token")
        else:
            token = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")

        session_token = session.get("csrf_token")

        if not token or not session_token:
            return jsonify({"error": "CSRF token invalid"}), 403

        if not hmac.compare_digest(token, session_token):
            return jsonify({"error": "CSRF token invalid"}), 403

        # Rotate token after successful validation
        session["csrf_token"] = _generate_token()
        return f(*args, **kwargs)

    return decorated_function
