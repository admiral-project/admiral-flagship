# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

from app import create_app
from app.admiral_client import _verify

def test_create_app():
    app = create_app()
    assert app is not None
    assert app.config["SECRET_KEY"] is not None

def test_app_config_defaults(app):
    assert app.config["SECRET_KEY"] == "test-secret"
    assert app.config["ADMIRAL_API_URL"] == "https://admirald.test:8080"
    assert app.config["SESSION_COOKIE_NAME"] == "flagship_session"
    assert app.config["SESSION_COOKIE_SECURE"] is True
    assert app.config["SESSION_REFRESH_EACH_REQUEST"] is True

def test_tls_verification_enabled_by_default(app):
    with app.app_context():
        assert _verify() is True

def test_create_app_runs_production_security_validation():
    from unittest.mock import patch
    with patch("app.validate_production_config") as validate_mock:
        create_app()
    validate_mock.assert_called_once()

def test_blueprints_registered(app):
    names = [bp.name for bp in app.blueprints.values()]
    assert "main" in names
    assert "auth" in names
    assert "bff_nodes" in names
    assert "bff_catalog" in names
    assert "bff_instances" in names
    assert "bff_backups" in names
    assert "bff_jobs" in names

