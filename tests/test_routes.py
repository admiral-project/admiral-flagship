# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0


def test_health(client):
    resp = client.get("/flagship/api/health")
    assert resp.status_code == 200
    assert resp.json["status"] == "healthy"


def test_health_rejects_external_ip(client):
    resp = client.get(
        "/flagship/api/health",
        environ_overrides={"REMOTE_ADDR": "198.51.100.10"},
    )
    assert resp.status_code == 403
    assert resp.json["status"] == "forbidden"


def test_ready_rejects_external_ip(client):
    resp = client.get(
        "/flagship/api/ready",
        environ_overrides={"REMOTE_ADDR": "198.51.100.10"},
    )
    assert resp.status_code == 403
    assert resp.json["status"] == "forbidden"


def test_index_returns_html(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"<html" in resp.data


def test_index_contains_vue_app(client):
    resp = client.get("/")
    assert b"Vue" in resp.data or b"vue" in resp.data


def test_index_contains_patternfly(client):
    resp = client.get("/")
    assert b"patternfly" in resp.data
    assert b"pf-c-page" in resp.data


def test_index_contains_login_view(client):
    resp = client.get("/")
    assert b"login-view" in resp.data


def test_index_exposes_csrf_meta_token(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b'<meta name="csrf-token" content="' in resp.data


def test_ready_success(client):
    from unittest.mock import patch

    with patch("app.routes.api_get", return_value={"status": "ok"}) as mock_get:
        resp = client.get("/flagship/api/ready")
        assert resp.status_code == 200
        assert resp.json["status"] == "ok"
        assert resp.json["admirald"] == "ok"
        assert "timestamp" in resp.json
        mock_get.assert_called_once_with("/api/v1/status")


def test_ready_failure(client):
    from unittest.mock import patch

    with patch("app.routes.api_get", side_effect=Exception("api connection error")) as mock_get:
        resp = client.get("/flagship/api/ready")
        assert resp.status_code == 200
        assert resp.json["status"] == "error"
        assert resp.json["admirald"] == "error"
        assert "Service temporarily unavailable" in resp.json["error"]
        assert "timestamp" in resp.json
        mock_get.assert_called_once_with("/api/v1/status")


def test_ip_allowed_invalid_remote_addr(client):
    # Pass an invalid/malformed remote address to trigger ValueError
    resp = client.get(
        "/flagship/api/health",
        environ_overrides={"REMOTE_ADDR": "not-a-valid-ip"},
    )
    assert resp.status_code == 403
    assert resp.json["status"] == "forbidden"
