
import pytest
from app.bff.instances import validate_instance_id
from app.bff.catalog import _extract_tiers
from app.csrf import generate_csrf_token, init_csrf_protection
from flask import Flask, session
import hmac
from app.security import validate_production_config

def test_validate_instance_id_safe():
    # Should not raise
    validate_instance_id("inst_123")
    validate_instance_id("my-instance-01")

def test_validate_instance_id_unsafe():
    with pytest.raises(ValueError):
        validate_instance_id("../etc/passwd")
    with pytest.raises(ValueError):
        validate_instance_id("inst; rm -rf /")
    with pytest.raises(ValueError):
        validate_instance_id("")

def test_extract_tiers_standard():
    yaml = """
tiers:
  small:
    cpu: 1
    memory: 2Gi
  large:
    cpu: 4
    memory: 8Gi
"""
    tiers = _extract_tiers(yaml)
    assert len(tiers) == 2
    assert tiers[0]["name"] == "small"
    assert tiers[0]["cpu"] == "1"
    assert tiers[1]["name"] == "large"

def test_extract_tiers_4_spaces():
    yaml = """
tiers:
    small:
        cpu: 1
    large:
        cpu: 4
"""
    tiers = _extract_tiers(yaml)
    assert len(tiers) == 2
    assert tiers[0]["name"] == "small"
    assert tiers[0]["cpu"] == "1"
    assert tiers[1]["name"] == "large"

def test_csrf_stability():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret"
    app.config["WTF_CSRF_ENABLED"] = False
    init_csrf_protection(app)

    with app.test_request_context():
        token = generate_csrf_token()
        session_token = session.get("csrf_token")
        assert token == session_token

        # Simulate validation
        # In a real request, csrf_protect would run
        # We want to ensure that if we call validation logic, it doesn't rotate
        # The logic we changed was in csrf_protect and require_csrf_token

    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess["csrf_token"] = "stable-token"

        # POST request should succeed with the token and NOT change it in session
        # We need to mock a POST to an API endpoint
        @app.route("/flagship/api/test", methods=["POST"])
        def test_route():
            return {"status": "ok"}

        resp = client.post("/flagship/api/test",
                           headers={"X-CSRF-Token": "stable-token"},
                           json={})
        assert resp.status_code == 200

        with client.session_transaction() as sess:
            assert sess["csrf_token"] == "stable-token"

def test_validate_production_config_repeating_secret():
    config = {
        "SECRET_KEY": "a" * 32,
        "ADMIRAL_ADMIN_TOKEN": "some-token",
        "SESSION_COOKIE_SECURE": True,
        "ADMIRAL_CA_FILE": "some-ca"
    }
    import os
    from unittest.mock import patch
    with patch.dict(os.environ, {"ENV": "production"}):
        with pytest.raises(ValueError, match="SECRET_KEY must not be a simple repeating character"):
            validate_production_config(config)

def test_validate_production_config_ok():
    config = {
        "SECRET_KEY": "abcdef" * 6, # Not a repeating character
        "ADMIRAL_ADMIN_TOKEN": "some-token",
        "SESSION_COOKIE_SECURE": True,
        "ADMIRAL_CA_FILE": "some-ca"
    }
    import os
    from unittest.mock import patch
    with patch.dict(os.environ, {"ENV": "production"}):
        validate_production_config(config)
