import os
import pytest
import requests
from flask import g, session
from unittest.mock import patch, Mock
from app.admiral_client import (
    _headers,
    _verify,
    _handle_request_exception,
    api_get,
    api_get_text,
    api_post,
    api_delete,
    api_put,
    logout_admin,
    reset_rate_limit,
)

def test_headers_admin(app):
    with app.test_request_context():
        with patch.dict(session, {"admin_token": "secret-admin-token"}):
            headers = _headers("/api/admin/nodes")
            assert headers == {"X-Admiral-Admin-Token": "secret-admin-token"}

def test_headers_general(app):
    with app.app_context():
        headers = _headers("/api/v1/nodes")
        assert headers == {"X-Admiral-Token": "test-token"}

def test_verify_skip(app):
    with patch.dict(os.environ, {"ADMIRAL_INSECURE_SKIP_VERIFY": "true"}):
        assert _verify() is False

def test_verify_ca_file(app):
    app.config["ADMIRAL_CA_FILE"] = "/path/to/ca.pem"
    with patch.dict(os.environ, {"ADMIRAL_INSECURE_SKIP_VERIFY": "false"}):
        with app.app_context():
            assert _verify() == "/path/to/ca.pem"

def test_verify_default(app):
    app.config["ADMIRAL_CA_FILE"] = ""
    with patch.dict(os.environ, {"ADMIRAL_INSECURE_SKIP_VERIFY": "false"}):
        with app.app_context():
            assert _verify() is True

def test_handle_request_exception(app):
    with app.test_request_context():
        mock_response = Mock()
        mock_response.status_code = 401
        e = requests.RequestException(response=mock_response)

        with patch.dict(session, {"admin_token": "some-token"}):
            _handle_request_exception(e)
            assert g.get("unauthorized_backend_call") is True

def test_api_get_success(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.json.return_value = {"key": "value"}
        mock_resp.status_code = 200
        with patch("app.admiral_client.requests.get", return_value=mock_resp):
            result = api_get("/some/path")
            assert result == {"key": "value"}

def test_api_get_failure(app):
    with app.app_context():
        mock_response = Mock()
        mock_response.status_code = 500
        with patch("app.admiral_client.requests.get", side_effect=requests.RequestException("error", response=mock_response)):
            with pytest.raises(requests.RequestException):
                api_get("/some/path")

def test_api_get_text_success(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.text = "raw text"
        mock_resp.status_code = 200
        with patch("app.admiral_client.requests.get", return_value=mock_resp):
            result = api_get_text("/some/path")
            assert result == "raw text"

def test_api_get_text_failure(app):
    with app.app_context():
        mock_response = Mock()
        mock_response.status_code = 500
        with patch("app.admiral_client.requests.get", side_effect=requests.RequestException("error", response=mock_response)):
            with pytest.raises(requests.RequestException):
                api_get_text("/some/path")

def test_api_post_success(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.json.return_value = {"status": "ok"}
        mock_resp.status_code = 200
        with patch("app.admiral_client.requests.post", return_value=mock_resp):
            result = api_post("/some/path", data={"data": 1})
            assert result == {"status": "ok"}

def test_api_post_failure(app):
    with app.app_context():
        mock_response = Mock()
        mock_response.status_code = 500
        with patch("app.admiral_client.requests.post", side_effect=requests.RequestException("error", response=mock_response)):
            with pytest.raises(requests.RequestException):
                api_post("/some/path", data={"data": 1})

def test_api_delete_success(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.json.return_value = {"deleted": True}
        mock_resp.status_code = 200
        with patch("app.admiral_client.requests.delete", return_value=mock_resp):
            result = api_delete("/some/path")
            assert result == {"deleted": True}

def test_api_delete_failure(app):
    with app.app_context():
        mock_response = Mock()
        mock_response.status_code = 500
        with patch("app.admiral_client.requests.delete", side_effect=requests.RequestException("error", response=mock_response)):
            with pytest.raises(requests.RequestException):
                api_delete("/some/path")

def test_api_put_success(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.json.return_value = {"updated": True}
        mock_resp.status_code = 200
        with patch("app.admiral_client.requests.put", return_value=mock_resp):
            result = api_put("/some/path", data={"data": 1})
            assert result == {"updated": True}

def test_api_put_failure(app):
    with app.app_context():
        mock_response = Mock()
        mock_response.status_code = 500
        with patch("app.admiral_client.requests.put", side_effect=requests.RequestException("error", response=mock_response)):
            with pytest.raises(requests.RequestException):
                api_put("/some/path", data={"data": 1})

def test_logout_admin_success(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.status_code = 200
        with patch("app.admiral_client.requests.post", return_value=mock_resp):
            assert logout_admin("token") is True

def test_logout_admin_failure(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.status_code = 401
        with patch("app.admiral_client.requests.post", return_value=mock_resp):
            assert logout_admin("token") is False

def test_logout_admin_exception(app):
    with app.app_context():
        with patch("app.admiral_client.requests.post", side_effect=requests.RequestException()):
            assert logout_admin("token") is False

def test_check_rate_limit_success(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"allowed": True, "remaining": 10}
        with patch("app.admiral_client.requests.post", return_value=mock_resp):
            from app.admiral_client import check_rate_limit
            allowed, remaining = check_rate_limit("id")
            assert allowed is True
            assert remaining == 10

def test_check_rate_limit_non_200(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.status_code = 500
        with patch("app.admiral_client.requests.post", return_value=mock_resp):
            from app.admiral_client import check_rate_limit
            allowed, remaining = check_rate_limit("id")
            assert allowed is False
            assert remaining == 0

def test_check_rate_limit_exception(app):
    with app.app_context():
        with patch("app.admiral_client.requests.post", side_effect=requests.RequestException()):
            from app.admiral_client import check_rate_limit
            allowed, remaining = check_rate_limit("id")
            assert allowed is False
            assert remaining == 0

def test_reset_rate_limit_failure(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.status_code = 500
        with patch("app.admiral_client.requests.post", return_value=mock_resp):
            # Should not raise exception
            reset_rate_limit("id")

def test_reset_rate_limit_exception(app):
    with app.app_context():
        with patch("app.admiral_client.requests.post", side_effect=requests.RequestException()):
            # Should not raise exception
            reset_rate_limit("id")

def test_login_admin_success(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"token": "t"}
        with patch("app.admiral_client.requests.post", return_value=mock_resp):
            from app.admiral_client import login_admin
            result = login_admin("u", "p")
            assert result == {"token": "t"}

def test_login_admin_failure(app):
    with app.app_context():
        mock_response = Mock()
        mock_response.status_code = 401
        with patch("app.admiral_client.requests.post", side_effect=requests.RequestException("err", response=mock_response)):
            from app.admiral_client import login_admin
            with pytest.raises(requests.RequestException):
                login_admin("u", "p")
