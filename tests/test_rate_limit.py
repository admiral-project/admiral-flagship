from unittest.mock import patch, Mock

from app.rate_limit import RateLimiter


def test_local_rate_limiter_blocks_and_resets():
    limiter = RateLimiter(max_attempts=2, window_seconds=10)

    assert limiter.is_allowed("198.51.100.10") == (True, 0)
    assert limiter.is_allowed("198.51.100.10") == (True, 0)
    allowed, remaining = limiter.is_allowed("198.51.100.10")
    assert allowed is False
    assert remaining >= 1

    limiter.reset("198.51.100.10")
    assert limiter.is_allowed("198.51.100.10") == (True, 0)


def test_check_rate_limit_allowed(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"allowed": True, "remaining": 0}

        with patch("app.admiral_client.requests.post", return_value=mock_resp):
            from app.admiral_client import check_rate_limit

            allowed, remaining = check_rate_limit("192.168.1.1")
            assert allowed is True
            assert remaining == 0


def test_check_rate_limit_denied(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"allowed": False, "remaining": 45}

        with patch("app.admiral_client.requests.post", return_value=mock_resp):
            from app.admiral_client import check_rate_limit

            allowed, remaining = check_rate_limit("192.168.1.1")
            assert allowed is False
            assert remaining == 45


def test_check_rate_limit_fallback_on_failure(app):
    with app.app_context():
        import requests

        with patch(
            "app.admiral_client.requests.post",
            side_effect=requests.RequestException("down"),
        ):
            from app.admiral_client import check_rate_limit

            allowed, remaining = check_rate_limit("192.168.1.1")
            assert allowed is True
            assert remaining == 0


def test_reset_rate_limit(app):
    with app.app_context():
        mock_resp = Mock()
        mock_resp.status_code = 200

        with patch("app.admiral_client.requests.post", return_value=mock_resp) as post:
            from app.admiral_client import reset_rate_limit

            reset_rate_limit("192.168.1.1")
            post.assert_called_once()


def test_login_rate_limited(app, client):
    with patch("app.admiral_client.check_rate_limit", return_value=(False, 30)):
        resp = client.post(
            "/flagship/api/auth/login",
            json={"username": "admin", "password": "secret"},
        )
        assert resp.status_code == 429
        assert "30" in resp.json["error"]


def test_login_passes_rate_limit_then_resets(app, client):
    with (
        patch("app.admiral_client.check_rate_limit", return_value=(True, 0)),
        patch("app.admiral_client.login_admin") as login_mock,
        patch("app.admiral_client.reset_rate_limit") as reset_mock,
    ):
        login_mock.return_value = {"token": "t", "password_change_required": False}
        resp = client.post(
            "/flagship/api/auth/login",
            json={"username": "admin", "password": "secret"},
        )
        assert resp.status_code == 200
        reset_mock.assert_called_once()


def test_login_failure_returns_generic_unauthorized(app, client):
    import requests
    from unittest.mock import Mock

    with patch("app.admiral_client.check_rate_limit", return_value=(True, 0)):
        mock_response = Mock()
        mock_response.status_code = 401
        mock_response.json.return_value = {"error": "invalid credentials"}
        http_error = requests.HTTPError("401 Unauthorized", response=mock_response)
        with patch("app.admiral_client.login_admin", side_effect=http_error):
            resp = client.post(
                "/flagship/api/auth/login",
                json={"username": "admin", "password": "secret"},
            )
    assert resp.status_code == 401
    assert resp.json["error"] == "unauthorized"
