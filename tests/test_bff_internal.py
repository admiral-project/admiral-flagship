import pytest
from unittest.mock import patch
from tests.test_bff import _mock_api_get, _mock_api_get_failure, _mock_api_post, _mock_api_delete, _mock_api_put

def test_node_detail_success(client):
    with patch("app.bff.nodes.api_get") as mock_get:
        mock_get.side_effect = [
            {"id": "n1", "hostname": "node1"}, # for node
            {"cpu": 10} # for metrics
        ]
        resp = client.get("/flagship/api/nodes/n1")
        assert resp.status_code == 200
        assert resp.json["node"]["id"] == "n1"
        assert resp.json["metrics"]["cpu"] == 10

def test_node_detail_no_metrics(client):
    with patch("app.bff.nodes.api_get") as mock_get:
        mock_get.side_effect = [
            {"id": "n1", "hostname": "node1"}, # for node
            Exception("metrics failed") # for metrics
        ]
        resp = client.get("/flagship/api/nodes/n1")
        assert resp.status_code == 200
        assert resp.json["node"]["id"] == "n1"
        assert resp.json["metrics"] is None

def test_node_detail_failure(client):
    with patch("app.bff.nodes.api_get", side_effect=Exception("api failed")):
        resp = client.get("/flagship/api/nodes/n1")
        assert resp.status_code == 502

def test_disable_node_success(client):
    with patch("app.bff.nodes.api_post", _mock_api_post({"success": True})):
        resp = client.post("/flagship/api/nodes/n1/disable")
        assert resp.status_code == 200
        assert resp.json["success"] is True

def test_disable_node_failure(client):
    with patch("app.bff.nodes.api_post", side_effect=Exception("fail")):
        resp = client.post("/flagship/api/nodes/n1/disable")
        assert resp.status_code == 502

def test_enable_node_success(client):
    with patch("app.bff.nodes.api_post", _mock_api_post({"success": True})):
        resp = client.post("/flagship/api/nodes/n1/enable")
        assert resp.status_code == 200

def test_enable_node_failure(client):
    with patch("app.bff.nodes.api_post", side_effect=Exception("fail")):
        resp = client.post("/flagship/api/nodes/n1/enable")
        assert resp.status_code == 502

def test_remove_node_success(client):
    with patch("app.bff.nodes.api_delete", _mock_api_delete({"success": True})):
        resp = client.delete("/flagship/api/nodes/n1")
        assert resp.status_code == 200

def test_remove_node_conflict(client):
    with patch("app.bff.nodes.api_delete", side_effect=Exception("has active instances")):
        resp = client.delete("/flagship/api/nodes/n1")
        assert resp.status_code == 409

def test_remove_node_failure(client):
    with patch("app.bff.nodes.api_delete", side_effect=Exception("other fail")):
        resp = client.delete("/flagship/api/nodes/n1")
        assert resp.status_code == 502

def test_app_detail_success(client):
    with patch("app.bff.catalog.api_get", _mock_api_get({"id": "a1"})):
        resp = client.get("/flagship/api/catalog/apps/a1")
        assert resp.status_code == 200
        assert resp.json["app"]["id"] == "a1"

def test_app_detail_failure(client):
    with patch("app.bff.catalog.api_get", side_effect=Exception("fail")):
        resp = client.get("/flagship/api/catalog/apps/a1")
        assert resp.status_code == 502

def test_app_yaml_failure(client):
    with patch("app.bff.catalog.api_get_text", side_effect=Exception("fail")):
        resp = client.get("/flagship/api/catalog/apps/a1/yaml")
        assert resp.status_code == 502

def test_app_provisioning_failure(client):
    with patch("app.bff.catalog.api_get", side_effect=Exception("fail")):
        resp = client.get("/flagship/api/catalog/apps/a1/provisioning")
        assert resp.status_code == 502

def test_save_app_no_yaml(client):
    resp = client.post("/flagship/api/catalog/apps/save", json={})
    assert resp.status_code == 400

def test_save_app_value_error(client):
    with patch("app.bff.catalog._bump_version", side_effect=ValueError("bad version")):
        resp = client.post("/flagship/api/catalog/apps/save", json={"app_id": "a1", "yaml": "..."})
        assert resp.status_code == 400
        assert resp.json["error"] == "bad version"

def test_app_tiers_success(client):
    with patch("app.bff.catalog.api_get", _mock_api_get([{"name": "t1"}])):
        resp = client.get("/flagship/api/catalog/apps/a1/tiers")
        assert resp.status_code == 200
        assert resp.json["tiers"][0]["name"] == "t1"

def test_app_tiers_failure(client):
    with patch("app.bff.catalog.api_get", side_effect=Exception("fail")):
        resp = client.get("/flagship/api/catalog/apps/a1/tiers")
        assert resp.status_code == 502
        assert resp.json["tiers"] == []

def test_save_app_tier_no_tier(client):
    resp = client.post("/flagship/api/catalog/apps/a1/tiers", json={})
    assert resp.status_code == 400

def test_save_app_tier_success(client):
    with patch("app.bff.catalog.api_post", _mock_api_post({"success": True})):
        resp = client.post("/flagship/api/catalog/apps/a1/tiers", json={"tier": {"name": "t1"}})
        assert resp.status_code == 200

def test_save_app_tier_failure(client):
    with patch("app.bff.catalog.api_post", side_effect=Exception("fail")):
        resp = client.post("/flagship/api/catalog/apps/a1/tiers", json={"tier": {"name": "t1"}})
        assert resp.status_code == 502

def test_app_versions_success(client):
    with patch("app.bff.catalog.api_get", _mock_api_get(["1.0.0"])):
        resp = client.get("/flagship/api/catalog/apps/a1/versions")
        assert resp.status_code == 200
        assert resp.json["versions"] == ["1.0.0"]

def test_app_versions_failure(client):
    with patch("app.bff.catalog.api_get", side_effect=Exception("fail")):
        resp = client.get("/flagship/api/catalog/apps/a1/versions")
        assert resp.status_code == 502
        assert resp.json["versions"] == []

def test_enable_app_success(client):
    with patch("app.bff.catalog.api_put", _mock_api_put({"success": True})):
        resp = client.post("/flagship/api/catalog/apps/a1/enable")
        assert resp.status_code == 200

def test_enable_app_failure(client):
    with patch("app.bff.catalog.api_put", side_effect=Exception("fail")):
        resp = client.post("/flagship/api/catalog/apps/a1/enable")
        assert resp.status_code == 502
