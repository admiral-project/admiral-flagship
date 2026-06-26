import os
from unittest import mock


def test_id_validation_bff_error_handling(client):
    """Verify that BFF routes return 400 for malformed resource IDs."""
    with client.session_transaction() as sess:
        sess["admin_token"] = "valid-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = 9999999999  # Far future

    # Flask test client will now receive a 400 response from the error handler
    # for these routes that explicitly call validate_resource_id

    headers = {"X-Requested-With": "XMLHttpRequest"}  # To trigger JSON response

    resp = client.get("/flagship/api/instances/invalid@id", headers=headers)
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Invalid request parameters"

    resp = client.get("/flagship/api/nodes/invalid;id", headers=headers)
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Invalid request parameters"

    resp = client.get("/flagship/api/catalog/apps/invalid id", headers=headers)
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Invalid request parameters"

    resp = client.get("/flagship/api/backups/invalid%id", headers=headers)
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Invalid request parameters"

    resp = client.get("/flagship/api/jobs/invalid*id", headers=headers)
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Invalid request parameters"


def test_health_ip_allowed_config_hardening(client):
    """Verify health endpoint respects FLAGSHIP_ALLOWED_HEALTH_IPS."""
    with mock.patch.dict(os.environ, {"FLAGSHIP_ALLOWED_HEALTH_IPS": "1.2.3.4/32"}):
        # Allowed IP
        resp = client.get("/flagship/api/health", environ_base={"REMOTE_ADDR": "1.2.3.4"})
        assert resp.status_code == 200

        # Blocked IP (localhost is not in the set above)
        resp = client.get("/flagship/api/health", environ_base={"REMOTE_ADDR": "127.0.0.1"})
        assert resp.status_code == 403


def test_proxy_fix_handling(app, client):
    """Verify ProxyFix handles X-Forwarded-For when configured."""
    # Since we cannot easily re-initialize the app in the middle of a test
    # to change wsgi_app, we verify the logic in a way that respects the
    # FLAGSHIP_PROXIES_COUNT setting.
    # By default it is 0 in create_app() if env not set.

    with mock.patch.dict(
        os.environ,
        {"FLAGSHIP_PROXIES_COUNT": "1", "FLAGSHIP_ALLOWED_HEALTH_IPS": "1.1.1.1/32"},
    ):
        # We need a new app instance to pick up the env var during creation
        from app import create_app

        test_app = create_app()
        test_client = test_app.test_client()

        # X-Forwarded-For: 1.1.1.1, 2.2.2.2
        # With num_proxies=1, ProxyFix picks 1.1.1.1 as remote_addr
        resp = test_client.get(
            "/flagship/api/health",
            headers={"X-Forwarded-For": "1.1.1.1"},
            environ_base={"REMOTE_ADDR": "10.0.0.1"},
        )  # Proxy IP
        # If ProxyFix worked, remote_addr becomes 1.1.1.1
        assert resp.status_code == 200
