from unittest.mock import patch
from tests.test_bff import _mock_api_get, _mock_api_post, _mock_api_delete, _mock_api_put


def test_node_detail_success(client):
    with patch("app.bff.nodes.api_get") as mock_get:
        mock_get.side_effect = [{"id": "n1", "hostname": "node1"}, {"cpu": 10}]  # for node  # for metrics
        resp = client.get("/flagship/api/nodes/n1")
        assert resp.status_code == 200
        assert resp.json["node"]["id"] == "n1"
        assert resp.json["metrics"]["cpu"] == 10


def test_node_detail_no_metrics(client):
    with patch("app.bff.nodes.api_get") as mock_get:
        mock_get.side_effect = [
            {"id": "n1", "hostname": "node1"},  # for node
            Exception("metrics failed"),  # for metrics
        ]
        resp = client.get("/flagship/api/nodes/n1")
        assert resp.status_code == 200
        assert resp.json["node"]["id"] == "n1"
        assert resp.json["metrics"] is None


def test_node_detail_logs_metrics_failure(client, caplog):
    with patch("app.bff.nodes.api_get") as mock_get:
        mock_get.side_effect = [{"id": "n1"}, Exception("metrics failed")]
        with caplog.at_level("WARNING", logger="admiral-flagship"):
            resp = client.get("/flagship/api/nodes/n1")
        assert resp.status_code == 200
        assert "Unable to retrieve node metrics" in caplog.text


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


def test_list_backups_value_error(client):
    resp = client.get("/flagship/api/backups?instance_id=invalid-id-!!!")
    assert resp.status_code == 400


def test_update_backup_settings_failure(client):
    with patch("app.bff.backups.api_put", side_effect=Exception("fail")):
        resp = client.put("/flagship/api/backups/settings", json={"backend": "s3"})
        assert resp.status_code == 502


def test_test_backup_settings_failure(client):
    with patch("app.bff.backups.api_post", side_effect=Exception("fail")):
        resp = client.post("/flagship/api/backups/settings/test")
        assert resp.status_code == 502


def test_trigger_backup_database_success(client):
    with patch("app.bff.backups.api_post", return_value={"success": True}):
        resp = client.post("/flagship/api/backups/trigger", json={"instance_id": "i1", "kind": "database"})
        assert resp.status_code == 200


def test_trigger_backup_database_failure(client):
    with patch("app.bff.backups.api_post", side_effect=Exception("fail")):
        resp = client.post("/flagship/api/backups/trigger", json={"instance_id": "i1", "kind": "database"})
        assert resp.status_code == 502


def test_extract_tiers_and_other_branches(client):
    mock_yaml = """# comment
version: 1.0.0
tiers:
  t1:
    cpu: 1
    # comment inside
    memory: 512
  t2:
    cpu: 2
other_root: 42
"""
    with (
        patch("app.bff.catalog.api_get", return_value={"id": "a1"}),
        patch("app.bff.catalog.api_get_text", return_value=mock_yaml),
    ):
        resp = client.get("/flagship/api/catalog/apps/a1/provisioning")
        assert resp.status_code == 200
        assert len(resp.json["tiers"]) == 2


def test_save_app_no_version(client):
    resp = client.post("/flagship/api/catalog/apps/save", json={"app_id": "a1", "yaml": "no-version: true"})
    assert resp.status_code == 400
    assert "version field is required" in resp.json["error"]


def test_save_app_invalid_version_parts(client):
    resp = client.post("/flagship/api/catalog/apps/save", json={"app_id": "a1", "yaml": "version: 1.0.a"})
    assert resp.status_code == 400
    assert "version must use only numeric segments" in resp.json["error"]


def test_save_app_exception(client):
    with patch("app.bff.catalog.api_post", side_effect=Exception("fail")):
        resp = client.post("/flagship/api/catalog/apps/save", json={"yaml": "version: 1.0.0"})
        assert resp.status_code == 502


def test_disable_app_failure(client):
    with patch("app.bff.catalog.api_put", side_effect=Exception("fail")):
        resp = client.post("/flagship/api/catalog/apps/a1/disable")
        assert resp.status_code == 502


def test_dashboard_with_degraded_nodes(client):
    mock_nodes = [{"id": "n1", "status": "active", "health_status": "degraded"}]
    with patch("app.bff.dashboard.api_get") as mock_get:
        mock_get.side_effect = [
            mock_nodes,  # nodes
            [],  # instances
            [],  # jobs / tasks
            [],  # backups
        ]
        resp = client.get("/flagship/api/dashboard")
        assert resp.status_code == 200
        assert any(alert["title"] == "Node health" for alert in resp.json["alerts"])


def test_dashboard_nodes_exception(client):
    with patch("app.bff.dashboard.api_get", side_effect=Exception("fail")):
        resp = client.get("/flagship/api/dashboard")
        assert resp.status_code == 502


def test_dashboard_instances_exception(client):
    with patch("app.bff.dashboard.api_get") as mock_get:
        mock_get.side_effect = [
            [],  # nodes
            Exception("fail"),  # instances
        ]
        resp = client.get("/flagship/api/dashboard")
        assert resp.status_code == 502


def test_dashboard_tasks_exception(client):
    with patch("app.bff.dashboard.api_get") as mock_get:
        mock_get.side_effect = [
            [],  # nodes
            [],  # instances
            Exception("fail"),  # tasks
        ]
        resp = client.get("/flagship/api/dashboard")
        assert resp.status_code == 502


def test_dashboard_backups_exception(client):
    with patch("app.bff.dashboard.api_get") as mock_get:
        mock_get.side_effect = [
            [],  # nodes
            [],  # instances
            [],  # tasks
            Exception("fail"),  # backups
        ]
        resp = client.get("/flagship/api/dashboard")
        assert resp.status_code == 502


def test_list_instances_invalid_customer_id(client):
    resp = client.get("/flagship/api/instances?customer_id=invalid-id-!!!")
    assert resp.status_code == 400


def test_list_instances_parameters(client):
    with patch("app.bff.instances.api_get", return_value={"items": [], "total": 0}):
        resp = client.get("/flagship/api/instances?status=running&customer_id=c1&app_definition_name=app1")
        assert resp.status_code == 200


def test_instance_credentials_failure(client):
    with patch("app.bff.instances.api_get", side_effect=Exception("fail")):
        resp = client.get("/flagship/api/instances/i1/credentials")
        assert resp.status_code == 502


def test_instance_tiers_no_app_id(client):
    with patch("app.bff.instances.api_get", return_value={"id": "i1"}):  # No app reference
        resp = client.get("/flagship/api/instances/i1/tiers")
        assert resp.status_code == 404


def test_instance_action_not_allowed(client):
    resp = client.post("/flagship/api/instances/i1/action", json={"action": "hack"})
    assert resp.status_code == 400


def test_migrate_instance_value_error(client):
    resp = client.post("/flagship/api/instances/i1/migrate", json={"node_id": "invalid-node-!!!"})
    assert resp.status_code == 400


def test_provision_instance_missing_fields(client):
    resp = client.post("/flagship/api/instances/provision", json={"tier_name": "t1"})
    assert resp.status_code == 400


def test_provision_instance_exception(client):
    with patch("app.bff.instances.api_post", side_effect=Exception("fail")):
        resp = client.post(
            "/flagship/api/instances/provision",
            json={"app_definition_name": "app1", "tier_name": "t1", "customer_id": "c1"},
        )
        assert resp.status_code == 502


def test_job_detail_failure(client):
    with patch("app.bff.jobs.api_get", side_effect=Exception("fail")):
        resp = client.get("/flagship/api/jobs/j1")
        assert resp.status_code == 502


def test_list_nodes_filtering(client):
    with patch("app.bff.nodes.api_get", return_value=[{"id": "n1", "node_role": "worker"}]):
        resp = client.get("/flagship/api/nodes?node_role=worker")
        assert resp.status_code == 200
        assert len(resp.json["nodes"]) == 1


def test_register_node_missing_fields(client):
    resp = client.post("/flagship/api/nodes/register", json={"node_id": "n1"})
    assert resp.status_code == 400


def test_register_node_invalid_hostname(client):
    resp = client.post(
        "/flagship/api/nodes/register", json={"node_id": "n1", "hostname": "bad_hostname", "ip": "1.1.1.1"}
    )
    assert resp.status_code == 400
