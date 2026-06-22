import time
from unittest.mock import patch


def test_auth_me_unauthenticated(client):
    resp = client.get("/flagship/api/auth/me")
    assert resp.status_code == 401
    assert resp.json["error"] == "unauthorized"


def test_auth_me_authenticated(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "test-admin-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())
    with patch("app.admiral_client.api_get", return_value={"username": "admin"}):
        resp = client.get("/flagship/api/auth/me")
    assert resp.status_code == 200
    assert resp.json["authenticated"] is True
    assert resp.json["username"] == "admin"


def test_auth_me_retries_then_succeeds(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "test-admin-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())
    calls = {"count": 0}

    def flaky(_path):
        calls["count"] += 1
        if calls["count"] == 1:
            raise Exception("temporary failure")
        return {"username": "admin"}

    with (
        patch("app.admiral_client.api_get", side_effect=flaky),
        patch("app.auth.time.sleep", return_value=None) as sleep_mock,
    ):
        resp = client.get("/flagship/api/auth/me")
    assert resp.status_code == 200
    assert calls["count"] == 2
    assert sleep_mock.call_count == 1


def test_auth_me_expired_session_after_retries(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "test-admin-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())
    with (
        patch("app.admiral_client.api_get", side_effect=Exception("down")),
        patch("app.auth.time.sleep", return_value=None) as sleep_mock,
    ):
        resp = client.get("/flagship/api/auth/me")
    assert resp.status_code == 401
    assert resp.json["error"] == "unauthorized"
    assert sleep_mock.call_count == 1
    with client.session_transaction() as sess:
        assert "admin_token" not in sess
        assert "admin_username" not in sess


def test_state_changing_request_requires_csrf_token(client):
    client.application.config["TESTING"] = False
    with client.session_transaction() as sess:
        sess["admin_token"] = "test-admin-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())
        sess["csrf_token"] = "csrf-test-token"
    try:
        resp = client.post(
            "/flagship/api/instances/i1/action",
            json={"action": "pause"},
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
    finally:
        client.application.config["TESTING"] = True
    assert resp.status_code == 403
    assert resp.json["error"] == "CSRF token missing"


def test_state_changing_request_accepts_valid_csrf_token(client):
    client.application.config["TESTING"] = False
    with client.session_transaction() as sess:
        sess["admin_token"] = "test-admin-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())
        sess["csrf_token"] = "csrf-test-token"
    try:
        with patch("app.bff.instances.api_post", return_value={"operation_id": "op1"}):
            resp = client.post(
                "/flagship/api/instances/i1/action",
                json={"action": "pause"},
                headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "X-CSRF-Token": "csrf-test-token",
                },
            )
    finally:
        client.application.config["TESTING"] = True
    assert resp.status_code == 200
    assert resp.json["operation_id"] == "op1"


def test_login_missing_fields(client):
    with patch("app.admiral_client.check_rate_limit", return_value=(True, 0)):
        resp = client.post("/flagship/api/auth/login", json={})
        assert resp.status_code == 400
        assert "username" in resp.json["error"]

        resp = client.post("/flagship/api/auth/login", json={"username": "admin"})
        assert resp.status_code == 400


def test_logout_clears_session(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "test-admin-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())
    resp = client.post("/flagship/api/auth/logout")
    assert resp.status_code == 200
    assert resp.json["status"] == "logged_out"
    with client.session_transaction() as sess:
        assert "admin_token" not in sess


def test_change_password_requires_active_session(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "test-admin-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time()) - 31 * 60
    with (
        patch("app.admiral_client.api_get", return_value={"username": "admin"}),
        patch("app.admiral_client.api_post") as post_mock,
    ):
        resp = client.post(
            "/flagship/api/auth/change-password",
            json={"current_password": "old", "new_password": "new"},
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
    assert resp.status_code == 401
    assert resp.json["error"] == "unauthorized"
    post_mock.assert_not_called()


def test_bff_endpoint_requires_auth(client):
    resp = client.get(
        "/flagship/api/nodes", headers={"X-Requested-With": "XMLHttpRequest"}
    )
    assert resp.status_code == 401
    assert resp.json["error"] == "unauthorized"


def test_bff_endpoint_browser_navigation_redirects_to_login(client):
    resp = client.get(
        "/flagship/api/nodes", headers={"Accept": "text/html"}, follow_redirects=False
    )
    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/")


def test_bff_endpoint_session_expired_inactivity(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "test-admin-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time()) - 31 * 60
    resp = client.get(
        "/flagship/api/nodes", headers={"X-Requested-With": "XMLHttpRequest"}
    )
    assert resp.status_code == 401
    assert resp.json["error"] == "unauthorized"
    with client.session_transaction() as sess:
        assert "admin_token" not in sess


def test_bff_endpoint_token_revoked_by_backend(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "revoked-token"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())

    import requests
    from unittest.mock import Mock

    mock_response = Mock()
    mock_response.status_code = 401
    mock_response.json.return_value = {"error": "Invalid token"}
    http_error = requests.HTTPError("401 Unauthorized", response=mock_response)

    with patch("app.admiral_client.requests.get", side_effect=http_error):
        resp = client.get(
            "/flagship/api/nodes", headers={"X-Requested-With": "XMLHttpRequest"}
    )

    assert resp.status_code == 401
    assert resp.json["error"] == "unauthorized"
    with client.session_transaction() as sess:
        assert "admin_token" not in sess
