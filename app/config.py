# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import os
from datetime import timedelta
from app.security import get_required_env_var


def _env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # Security: Use environment variables for secrets
    # In production, these MUST be set or app will fail to start
    SECRET_KEY = get_required_env_var(
        "FLAGSHIP_SECRET_KEY",
        required=True,
    )

    ADMIRAL_ADMIN_TOKEN = get_required_env_var(
        "ADMIRAL_ADMIN_TOKEN", default="dev-token-change-in-production", prod_mode=True
    )

    ADMIRAL_API_URL = os.environ.get("ADMIRAL_API_URL", "https://127.0.0.1:8080")
    ADMIRAL_CA_FILE = os.environ.get("ADMIRAL_CA_FILE", "")

    # Session security settings
    SESSION_COOKIE_NAME = "flagship_session"
    SESSION_COOKIE_HTTPONLY = True  # Prevent JavaScript access
    SESSION_COOKIE_SECURE = _env_bool("FLAGSHIP_SESSION_COOKIE_SECURE", True)  # HTTPS only
    SESSION_COOKIE_SAMESITE = "Strict"  # Strict CSRF protection (changed from Lax)
    SESSION_REFRESH_EACH_REQUEST = True  # Extend timeout on each request
    SESSION_TIMEOUT_MINUTES = int(os.environ.get("FLAGSHIP_SESSION_TIMEOUT_MINUTES", "30"))
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=SESSION_TIMEOUT_MINUTES)

    # Additional security settings
    PREFERRED_URL_SCHEME = "https"  # Force HTTPS in URL generation
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max request size (for YAML uploads)
