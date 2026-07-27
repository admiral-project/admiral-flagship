import time
from unittest.mock import Mock, patch

import requests

from app.auth import _extract_error


def test_extract_error():
    mock_resp = Mock()
    mock_resp.json.return_value = {"error": "detailed error"}
    err = requests.HTTPError(response=mock_resp)
    assert _extract_error(err) == "detailed error"

    mock_resp.json.side_effect = Exception()
    assert _extract_error(err) == "Request failed"


def test_login_password_change_required(client):
    with patch("app.admiral_client.check_rate_limit", return_value=(True, 0)):
        with patch("app.admiral_client.login_admin") as login_mock:
            login_mock.return_value = {"token": "test-token", "password_change_required": True}
            resp = client.post("/flagship/api/auth/login", json={"username": "admin", "password": "password"})
            assert resp.status_code == 200
            assert resp.json["password_change_required"] is True
            with client.session_transaction() as sess:
                assert sess["admin_token"] == "test-token"
                assert sess["password_change_required"] is True


def test_login_csrf_regenerated_on_login(client):
    with client.session_transaction() as sess:
        sess["csrf_token"] = "keep-me"

    with patch("app.admiral_client.check_rate_limit", return_value=(True, 0)):
        with patch("app.admiral_client.login_admin") as login_mock:
            login_mock.return_value = {"token": "t", "password_change_required": False}
            client.post("/flagship/api/auth/login", json={"username": "a", "password": "b"})
            with client.session_transaction() as sess:
                assert sess["csrf_token"] != "keep-me"


def test_change_password_first_login(client):
    # No admin_token in session, but password_change_required is True
    with client.session_transaction() as sess:
        sess["admin_username"] = "admin"
        sess["password_change_required"] = True
        sess["session_started_at"] = int(time.time())

    with patch("app.admiral_client.api_post") as post_mock:
        post_mock.return_value = {"status": "ok"}
        resp = client.post(
            "/flagship/api/auth/change-password",
            json={"username": "admin", "current_password": "old", "new_password": "new"},
        )
        assert resp.status_code == 200
        assert resp.json["status"] == "ok"
        post_mock.assert_called_once()


def test_change_password_first_login_missing_username(client):
    with client.session_transaction() as sess:
        sess["admin_username"] = "admin"
        sess["password_change_required"] = True
        sess["session_started_at"] = int(time.time())

    resp = client.post("/flagship/api/auth/change-password", json={"current_password": "old", "new_password": "new"})
    assert resp.status_code == 400
    assert "username required" in resp.json["error"]


def test_change_password_error_handling(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "t"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())

    mock_resp = Mock()
    mock_resp.status_code = 400
    mock_resp.json.return_value = {"error": "weak password"}
    err = requests.HTTPError(response=mock_resp)

    with patch("app.auth._validate_session_or_expire", return_value=None):
        with patch("app.admiral_client.api_post", side_effect=err):
            resp = client.post(
                "/flagship/api/auth/change-password", json={"current_password": "old", "new_password": "weak"}
            )
            assert resp.status_code == 400
            assert resp.json["error"] == "unauthorized"  # Based on _generic_auth_failure


def test_change_password_exception(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "t"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())

    with patch("app.auth._validate_session_or_expire", return_value=None):
        with patch("app.admiral_client.api_post", side_effect=Exception("boom")):
            resp = client.post(
                "/flagship/api/auth/change-password", json={"current_password": "old", "new_password": "new"}
            )
            assert resp.status_code == 400
            assert resp.json["error"] == "password change failed"


def test_login_exception(client):
    with patch("app.admiral_client.check_rate_limit", return_value=(True, 0)):
        with patch("app.admiral_client.login_admin", side_effect=Exception("oops")):
            resp = client.post("/flagship/api/auth/login", json={"username": "a", "password": "b"})
            assert resp.status_code == 401


def test_logout_exception(client):
    with client.session_transaction() as sess:
        sess["admin_token"] = "t"
        sess["admin_username"] = "admin"
        sess["session_started_at"] = int(time.time())
    with patch("app.admiral_client.logout_admin", side_effect=Exception("err")):
        resp = client.post("/flagship/api/auth/logout")
        assert resp.status_code == 200


def test_me_password_change_required_expired(client):
    with client.session_transaction() as sess:
        sess["admin_username"] = "admin"
        sess["password_change_required"] = True
        sess["session_started_at"] = int(time.time()) - 3600
    resp = client.get("/flagship/api/auth/me")
    assert resp.status_code == 401


def test_change_password_missing_fields(client):
    resp = client.post("/flagship/api/auth/change-password", json={})
    assert resp.status_code == 400
