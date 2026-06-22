# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

"""
Security utilities: secret validation, safe error messages, security headers.
"""

import os
import re
import logging
from typing import Optional

logger = logging.getLogger("admiral-flagship")

# Safe character set for resource identifiers (alphanumeric, underscores, hyphens)
_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def validate_resource_id(resource_id: str, context: str = "resource") -> None:
    """
    Validate that a resource identifier contains only safe characters.
    Prevents path traversal and injection-style attacks.

    Args:
        resource_id: The ID to validate
        context: Name of the resource for error messaging

    Raises:
        ValueError: If ID is invalid
    """
    if not resource_id or not _ID_RE.match(resource_id):
        logger.warning(
            "Invalid resource identifier blocked",
            extra={"id": resource_id, "context": context},
        )
        raise ValueError(f"Invalid {context} identifier: {resource_id!r}")


def get_required_env_var(
    name: str, default: Optional[str] = None, prod_mode: bool = False
) -> str:
    """
    Get required environment variable with validation.

    In production mode, raises ValueError if env var not set.
    In development, logs warning and uses default if provided.

    Args:
        name: Environment variable name
        default: Default value (dev only)
        prod_mode: If True, fail on missing var in production

    Returns:
        Environment variable value

    Raises:
        ValueError: If in production and required var not set
    """
    value = os.environ.get(name)

    if not value:
        is_production = os.environ.get("ENV", "").lower() == "production"

        if is_production and prod_mode:
            raise ValueError(
                f"SECURITY: Required environment variable {name} not set in production. "
                f"Set {name} before starting the application."
            )

        if default:
            logger.warning(
                f"Environment variable {name} not set; using development default. "
                f"This value is required for production and must be set explicitly.",
                extra={"var": name},
            )
            return default

        if is_production:
            raise ValueError(
                f"SECURITY: Environment variable {name} is required but not set"
            )

        logger.warning(f"Environment variable {name} not set", extra={"var": name})
        return ""

    return value


def sanitize_error_message(error: Exception, context: str = "") -> str:
    """
    Convert exception to safe, user-friendly error message.
    Logs full error internally for debugging.

    Args:
        error: Exception object
        context: Context description (e.g., "dashboard.nodes")

    Returns:
        Safe error message for client
    """
    error_str = str(error).lower()
    error_type = type(error).__name__

    # Log full details for debugging
    logger.error(
        "Operation error",
        extra={"context": context, "type": error_type, "details": str(error)},
    )

    # Map error patterns to safe messages
    if any(phrase in error_str for phrase in ["404", "not found", "does not exist"]):
        return "Resource not found"

    if any(
        phrase in error_str
        for phrase in ["401", "403", "unauthorized", "forbidden", "not permitted"]
    ):
        return "Not authorized for this action"

    if error_type == "ValueError" or any(
        phrase in error_str for phrase in ["400", "bad request", "invalid", "malformed"]
    ):
        return "Invalid request parameters"

    if any(phrase in error_str for phrase in ["500", "internal server", "unexpected"]):
        return "Server error - please contact support"

    if any(phrase in error_str for phrase in ["timeout", "deadline", "timed out"]):
        return "Request timed out - please try again"

    if any(phrase in error_str for phrase in ["connection", "refused", "unavailable"]):
        return "Service temporarily unavailable - please try again"

    # Default safe message
    return "Operation failed - please try again or contact support"


def init_security_headers(app):
    """
    Initialize security headers on Flask app.

    Adds:
    - X-Content-Type-Options: nosniff (prevent MIME sniffing)
    - X-Frame-Options: DENY (prevent clickjacking)
    - X-XSS-Protection: 1; mode=block (XSS filter)
    - Strict-Transport-Security (HTTPS enforcement)
    - Content-Security-Policy (XSS/injection protection)
    - Referrer-Policy (privacy)
    """

    @app.after_request
    def add_security_headers(response):
        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"

        # Enable XSS filter in older browsers
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Strict HTTPS enforcement (if secure)
        if os.environ.get("FLAGSHIP_SESSION_COOKIE_SECURE", "true").lower() in (
            "true",
            "1",
            "yes",
        ):
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )

        # Content Security Policy - strict for admin console
        # Only allow resources from same origin and CDN for PatternFly/Vue
        # 'unsafe-eval' required by Vue 3 template compiler for inline string templates
        csp = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-eval' https://unpkg.com https://cdnjs.cloudflare.com; "
            "style-src 'self' https://cdnjs.cloudflare.com https://unpkg.com; "
            "img-src 'self' data:; "
            "font-src 'self' https://cdnjs.cloudflare.com https://unpkg.com; "
            "connect-src 'self'; "  # API calls only to same origin
            "frame-ancestors 'none'; "  # Cannot be embedded in iframes
            "base-uri 'self'; "
            "form-action 'self'"
        )
        response.headers["Content-Security-Policy"] = csp

        # Don't leak referrer to external sites
        response.headers["Referrer-Policy"] = "same-origin"

        # Permissions policy (prevent access to sensitive features)
        response.headers["Permissions-Policy"] = (
            "geolocation=(), " "microphone=(), " "camera=(), " "usb=(), " "payment=()"
        )

        return response

    logger.info("Security headers initialized")


def validate_production_config(config):
    """
    Validate critical security settings for production deployment.

    Raises:
        ValueError: If production security requirements not met
    """
    is_production = os.environ.get("ENV", "").lower() == "production"

    if not is_production:
        if config.get("SECRET_KEY", "").startswith("dev-"):
            logger.warning(
                "FLAGSHIP_SECRET_KEY is using the development default; set it explicitly for production"
            )
        if config.get("ADMIRAL_ADMIN_TOKEN", "").startswith("dev-"):
            logger.warning(
                "ADMIRAL_ADMIN_TOKEN is using the development default; set it explicitly for production"
            )
        logger.warning("Running in non-production mode - some security checks relaxed")
        return

    errors = []

    # Check SECRET_KEY not dev default
    if config.get("SECRET_KEY", "").startswith("dev-"):
        errors.append("SECRET_KEY must not use development default in production")

    if len(config.get("SECRET_KEY", "")) < 32:
        errors.append("SECRET_KEY must be at least 32 characters in production")

    # Check ADMIRAL_ADMIN_TOKEN not dev default
    if config.get("ADMIRAL_ADMIN_TOKEN", "").startswith("dev-"):
        errors.append(
            "ADMIRAL_ADMIN_TOKEN must not use development default in production"
        )

    # Check HTTPS enabled
    if not config.get("SESSION_COOKIE_SECURE", True):
        errors.append(
            "SESSION_COOKIE_SECURE must be True (HTTPS required) in production"
        )

    # Check ADMIRAL_CA_FILE set for HTTPS verification (optional but recommended)
    if not config.get("ADMIRAL_CA_FILE"):
        logger.warning(
            "ADMIRAL_CA_FILE not set - TLS verification will use system certs"
        )

    if errors:
        error_msg = "\n".join(f"  - {e}" for e in errors)
        raise ValueError(f"Production security validation failed:\n{error_msg}")

    logger.info("Production security configuration validated")
