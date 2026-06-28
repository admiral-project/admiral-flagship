import pytest
from flask import session, jsonify
from app.csrf import generate_csrf_token, require_csrf_token

def test_generate_csrf_token(app):
    with app.test_request_context():
        token = generate_csrf_token()
        assert "csrf_token" in session
        assert session["csrf_token"] == token

        token2 = generate_csrf_token()
        assert token2 == token

def test_require_csrf_token_decorator(app):
    @app.route("/protected", methods=["POST"])
    @require_csrf_token
    def protected():
        return jsonify({"status": "ok"})

    client = app.test_client()

    # Missing token
    resp = client.post("/protected")
    assert resp.status_code == 403

    # Valid token in header
    with client.session_transaction() as sess:
        sess["csrf_token"] = "test-token"

    resp = client.post("/protected", headers={"X-CSRF-Token": "test-token"})
    assert resp.status_code == 200
    assert resp.json == {"status": "ok"}

    # Token should be rotated
    with client.session_transaction() as sess:
        assert sess["csrf_token"] != "test-token"

def test_csrf_protect_safe_methods(app):
    # init_csrf_protection(app) is already called in create_app
    client = app.test_client()
    app.config["TESTING"] = False
    try:
        resp = client.get("/flagship/api/nodes")
        # Should bypass CSRF, might fail with 401 but not 403 CSRF
        assert resp.status_code != 403
    finally:
        app.config["TESTING"] = True

def test_csrf_protect_public_endpoints(app):
    client = app.test_client()
    app.config["TESTING"] = False
    try:
        # Login is public
        resp = client.post("/flagship/api/auth/login", json={"username": "a", "password": "b"})
        assert resp.status_code != 403
    finally:
        app.config["TESTING"] = True

def test_csrf_protect_form_data(app):
    @app.route("/flagship/api/form", methods=["POST"])
    def form_handler():
        return jsonify({"status": "ok"})

    client = app.test_client()
    app.config["TESTING"] = False
    try:
        with client.session_transaction() as sess:
            sess["admin_token"] = "valid-token"
            sess["admin_username"] = "admin"
            import time
            sess["session_started_at"] = int(time.time())
            sess["csrf_token"] = "form-token"

        resp = client.post("/flagship/api/form", data={"csrf_token": "form-token"})
        assert resp.status_code == 200
    finally:
        app.config["TESTING"] = True

def test_csrf_protect_invalid_session(app):
    client = app.test_client()
    app.config["TESTING"] = False
    try:
        # Token provided but no token in session
        resp = client.post("/flagship/api/nodes", headers={"X-CSRF-Token": "some-token"})
        assert resp.status_code == 401
        assert resp.json["error"] == "Session invalid"
    finally:
        app.config["TESTING"] = True

def test_csrf_protect_invalid_token(app):
    client = app.test_client()
    app.config["TESTING"] = False
    try:
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid-token"

        resp = client.post("/flagship/api/nodes", headers={"X-CSRF-Token": "wrong-token"})
        assert resp.status_code == 403
        assert resp.json["error"] == "CSRF token invalid"
    finally:
        app.config["TESTING"] = True

def test_csrf_protect_non_api_endpoint(app):
    @app.route("/not-api", methods=["POST"])
    def not_api():
        return "ok"

    client = app.test_client()
    app.config["TESTING"] = False
    try:
        resp = client.post("/not-api")
        assert resp.status_code == 200
    finally:
        app.config["TESTING"] = True

def test_csrf_protect_json_body(app):
    @app.route("/flagship/api/json-post", methods=["POST"])
    def json_handler():
        return jsonify({"status": "ok"})

    client = app.test_client()
    app.config["TESTING"] = False
    try:
        with client.session_transaction() as sess:
            sess["admin_token"] = "valid-token"
            sess["admin_username"] = "admin"
            import time
            sess["session_started_at"] = int(time.time())
            sess["csrf_token"] = "json-token"

        resp = client.post("/flagship/api/json-post", json={"csrf_token": "json-token"})
        assert resp.status_code == 200
    finally:
        app.config["TESTING"] = True

def test_csrf_template_global(app):
    with app.test_request_context():
        from flask import render_template_string
        render_template_string("{{ csrf_token() }}")
        assert "csrf_token" in session
