# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

def test_health(client):
    resp = client.get("/flagship/api/health")
    assert resp.status_code == 200
    assert resp.json["status"] == "healthy"

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
