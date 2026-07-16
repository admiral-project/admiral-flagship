import os
import pytest
from unittest.mock import patch
from app.security import (
    validate_resource_id,
    get_required_env_var,
    sanitize_error_message,
    validate_production_config,
    init_security_headers,
)


def test_validate_resource_id_valid():
    validate_resource_id("valid-id_123")
    validate_resource_id("another_Valid-ID")


def test_validate_resource_id_invalid():
    with pytest.raises(ValueError, match="Invalid resource identifier"):
        validate_resource_id("invalid id")
    with pytest.raises(ValueError, match="Invalid resource identifier"):
        validate_resource_id("invalid/id")
    with pytest.raises(ValueError, match="Invalid resource identifier"):
        validate_resource_id("")


def test_get_required_env_var_dev():
    with patch.dict(os.environ, clear=True):
        # ENV is not set, so it's not production
        assert get_required_env_var("TEST_VAR", default="default") == "default"
        assert get_required_env_var("TEST_VAR") == ""

    with patch.dict(os.environ, {"MY_VAR": "val"}):
        assert get_required_env_var("MY_VAR") == "val"


def test_get_required_env_var_prod():
    with patch.dict(os.environ, {"ENV": "production"}, clear=True):
        with pytest.raises(ValueError, match="is required but not set"):
            get_required_env_var("PROD_VAR")

        with pytest.raises(ValueError, match="not set in production"):
            get_required_env_var("PROD_VAR", prod_mode=True)


def test_get_required_env_var_required_in_development():
    with patch.dict(os.environ, {}, clear=True):
        with pytest.raises(ValueError, match="Required environment variable REQUIRED_VAR"):
            get_required_env_var("REQUIRED_VAR", required=True)


def test_sanitize_error_message_patterns():
    assert sanitize_error_message(Exception("404 Not Found")) == "Resource not found"
    assert sanitize_error_message(Exception("unauthorized access")) == "Not authorized for this action"
    assert sanitize_error_message(ValueError("invalid input")) == "Invalid request parameters"
    assert sanitize_error_message(Exception("400 Bad Request")) == "Invalid request parameters"
    assert sanitize_error_message(Exception("500 Internal Error")) == "Server error - please contact support"
    assert sanitize_error_message(Exception("timed out")) == "Request timed out - please try again"
    assert (
        sanitize_error_message(Exception("connection refused")) == "Service temporarily unavailable - please try again"
    )
    assert (
        sanitize_error_message(Exception("something else")) == "Operation failed - please try again or contact support"
    )


def test_validate_production_config_non_prod(app):
    with patch.dict(os.environ, {"ENV": "development"}):
        config = {"SECRET_KEY": "dev-key", "ADMIRAL_ADMIN_TOKEN": "dev-token"}
        # Should not raise, just log warnings
        validate_production_config(config)


def test_validate_production_config_prod_errors():
    with patch.dict(os.environ, {"ENV": "production"}):
        config = {"SECRET_KEY": "dev-key", "ADMIRAL_ADMIN_TOKEN": "dev-token", "SESSION_COOKIE_SECURE": False}
        with pytest.raises(ValueError) as excinfo:
            validate_production_config(config)

        err_msg = str(excinfo.value)
        assert "SECRET_KEY must not use development default" in err_msg
        assert "SECRET_KEY must be at least 32 characters" in err_msg
        assert "ADMIRAL_ADMIN_TOKEN must not use development default" in err_msg
        assert "SESSION_COOKIE_SECURE must be True" in err_msg


def test_validate_production_config_prod_success():
    with patch.dict(os.environ, {"ENV": "production"}):
        config = {
            "SECRET_KEY": "a" * 32,
            "ADMIRAL_ADMIN_TOKEN": "not-dev-token",
            "SESSION_COOKIE_SECURE": True,
            "ADMIRAL_CA_FILE": "/path/to/ca",
        }
        validate_production_config(config)


def test_init_security_headers(app):
    init_security_headers(app)
    client = app.test_client()
    with patch.dict(os.environ, {"FLAGSHIP_SESSION_COOKIE_SECURE": "true"}):
        resp = client.get("/")
        assert resp.headers["X-Content-Type-Options"] == "nosniff"
        assert resp.headers["X-Frame-Options"] == "DENY"
        assert resp.headers["X-XSS-Protection"] == "1; mode=block"
        assert "Strict-Transport-Security" in resp.headers
        assert "Content-Security-Policy" in resp.headers
        assert resp.headers["Referrer-Policy"] == "same-origin"
        assert "Permissions-Policy" in resp.headers


def test_init_security_headers_no_hsts(app):
    # Re-init might add multiple hooks, but for testing it's fine
    init_security_headers(app)
    client = app.test_client()
    with patch.dict(os.environ, {"FLAGSHIP_SESSION_COOKIE_SECURE": "false"}):
        resp = client.get("/")
        assert "Strict-Transport-Security" not in resp.headers
