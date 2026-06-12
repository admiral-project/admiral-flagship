# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

"""BFF endpoint tests using mocked admirald API.

These tests verify that BFF endpoints:
1. Return proper JSON structure
2. Handle admirald API failures gracefully (502 with error message)
3. Pass query parameters correctly
"""

import json
from unittest.mock import patch


def _mock_api_get(data):
    """Helper to mock admirald_client.api_get with static data."""
    def mock_get(path):
        return data
    return mock_get


def _mock_api_post(data):
    """Helper to mock admirald_client.api_post with static data."""
    def mock_post(path, body=None):
        return data
    return mock_post


def _mock_api_get_failure():
    """Helper to mock admirald_client.api_get with an exception."""
    def mock_get(path):
        raise Exception("Connection refused")
    return mock_get


def _mock_api_post_failure():
    """Helper to mock admirald_client.api_post with an exception."""
    def mock_post(path, body=None):
        raise Exception("Connection refused")
    return mock_post


def _mock_api_put(data):
    def mock_put(path, body=None):
        return data
    return mock_put


def _mock_api_delete(data):
    def mock_delete(path):
        return data
    return mock_delete


def _mock_api_delete_failure():
    def mock_delete(path):
        raise Exception("Connection refused")
    return mock_delete


class TestBFFNodes:
    def test_nodes_list(self, client):
        with patch("app.bff.nodes.api_get", _mock_api_get([{"id": "n1", "hostname": "node1"}])):
            resp = client.get("/flagship/api/nodes")
            assert resp.status_code == 200
            assert resp.json["nodes"][0]["id"] == "n1"
            assert resp.json["page"] == 1

    def test_nodes_list_status_filter(self, client):
        with patch("app.bff.nodes.api_get", _mock_api_get([
            {"id": "n1", "hostname": "node1", "status": "online"},
            {"id": "n2", "hostname": "node2", "status": "offline"},
        ])):
            resp = client.get("/flagship/api/nodes?status=offline")
            assert resp.status_code == 200
            assert len(resp.json["nodes"]) == 1
            assert resp.json["nodes"][0]["id"] == "n2"

    def test_nodes_list_failure(self, client):
        with patch("app.bff.nodes.api_get", _mock_api_get_failure()):
            resp = client.get("/flagship/api/nodes")
            assert resp.status_code == 502
            assert "error" in resp.json
            assert resp.json["nodes"] == []


class TestBFFCatalog:
    def test_apps_list(self, client):
        with patch("app.bff.catalog.api_get", _mock_api_get([{"id": "a1", "name": "whoami"}])):
            resp = client.get("/flagship/api/catalog/apps")
            assert resp.status_code == 200
            assert resp.json["apps"][0]["name"] == "whoami"
            assert resp.json["total"] == 1

    def test_apps_list_failure(self, client):
        with patch("app.bff.catalog.api_get", _mock_api_get_failure()):
            resp = client.get("/flagship/api/catalog/apps")
            assert resp.status_code == 502
            assert resp.json["apps"] == []

    def test_app_yaml(self, client):
        with patch("app.bff.catalog.api_get_text", lambda path: "name: whoami\nversion: 1.0.0\n"):
            resp = client.get("/flagship/api/catalog/apps/whoami/yaml")
            assert resp.status_code == 200
            assert "version: 1.0.0" in resp.json["yaml"]

    def test_save_app(self, client):
        with patch("app.bff.catalog.api_post", _mock_api_post({"success": True, "name": "whoami"})):
            resp = client.post("/flagship/api/catalog/apps/save", json={"yaml": "name: whoami\nversion: 1.0.0\n"})
            assert resp.status_code == 200
            assert resp.json["name"] == "whoami"

    def test_edit_app_bumps_version(self, client):
        with patch("app.bff.catalog.api_post", _mock_api_post({"success": True, "name": "whoami"})):
            resp = client.post("/flagship/api/catalog/apps/save", json={"app_id": "whoami", "yaml": "name: whoami\nversion: 1.0.0\n"})
            assert resp.status_code == 200
            assert resp.json["version"] == "1.0.1"

    def test_disable_app(self, client):
        with patch("app.bff.catalog.api_put", _mock_api_put({"success": True, "status": "inactive"})):
            resp = client.post("/flagship/api/catalog/apps/whoami/disable")
            assert resp.status_code == 200
            assert resp.json["status"] == "inactive"

    def test_app_provisioning(self, client):
        with patch("app.bff.catalog.api_get", _mock_api_get({"id": "whoami", "name": "whoami"})), \
             patch("app.bff.catalog.api_get_text", lambda path: "name: whoami\ntiers:\n  starter:\n    cpu: 0.5\n    memory: 512Mi\n    storage: 5Gi\n    price_monthly: 9.99\n"):
            resp = client.get("/flagship/api/catalog/apps/whoami/provisioning")
            assert resp.status_code == 200
            assert resp.json["tiers"][0]["name"] == "starter"


class TestBFFInstances:
    def test_list_instances(self, client):
        with patch("app.bff.instances.api_get", _mock_api_get({"items": [{"id": "i1"}], "page": 1, "page_size": 20, "total": 1})):
            resp = client.get("/flagship/api/instances")
            assert resp.status_code == 200
            assert resp.json["instances"][0]["id"] == "i1"
            assert resp.json["total"] == 1

    def test_list_instances_failure(self, client):
        with patch("app.bff.instances.api_get", _mock_api_get_failure()):
            resp = client.get("/flagship/api/instances")
            assert resp.status_code == 502
            assert resp.json["instances"] == []

    def test_instance_detail(self, client):
        with patch("app.bff.instances.api_get", _mock_api_get({"id": "i1", "status": "running"})):
            resp = client.get("/flagship/api/instances/i1")
            assert resp.status_code == 200
            assert resp.json["status"] == "running"

    def test_instance_detail_failure(self, client):
        with patch("app.bff.instances.api_get", _mock_api_get_failure()):
            resp = client.get("/flagship/api/instances/i1")
            assert resp.status_code == 502

    def test_instance_action_missing_action(self, client):
        resp = client.post("/flagship/api/instances/i1/action", json={})
        assert resp.status_code == 400

    def test_instance_action(self, client):
        with patch("app.bff.instances.api_post", _mock_api_post({"operation_id": "op1"})):
            resp = client.post("/flagship/api/instances/i1/action", json={"action": "pause"})
            assert resp.status_code == 200
            assert resp.json["operation_id"] == "op1"

    def test_instance_action_failure(self, client):
        with patch("app.bff.instances.api_post", _mock_api_post_failure()):
            resp = client.post("/flagship/api/instances/i1/action", json={"action": "pause"})
            assert resp.status_code == 502

    def test_provision_instance(self, client):
        with patch("app.bff.instances.api_post", _mock_api_post({"operation_id": "op1", "status": "queued"})):
            resp = client.post("/flagship/api/instances/provision", json={
                "app_definition_name": "whoami",
                "tier_name": "starter",
                "customer_id": "cust1",
            })
            assert resp.status_code == 200
            assert resp.json["operation_id"] == "op1"


class TestBFFBackups:
    def test_list_backups(self, client):
        with patch("app.bff.backups.api_get", _mock_api_get({"items": [{"id": "b1"}], "page": 1, "page_size": 20, "total": 1})):
            resp = client.get("/flagship/api/backups")
            assert resp.status_code == 200
            assert resp.json["backups"][0]["id"] == "b1"
            assert resp.json["total"] == 1

    def test_list_backups_with_filter(self, client):
        def check_path(path):
            assert "instance_id=inst1" in path
            assert "page=1" in path
            assert "page_size=20" in path
            return {"items": [{"id": "b1", "instance_id": "inst1"}], "page": 1, "page_size": 20, "total": 1}
        with patch("app.bff.backups.api_get", check_path):
            resp = client.get("/flagship/api/backups?instance_id=inst1")
            assert resp.status_code == 200

    def test_trigger_backup_missing_id(self, client):
        resp = client.post("/flagship/api/backups/trigger", json={})
        assert resp.status_code == 400

    def test_trigger_backup(self, client):
        with patch("app.bff.backups.api_post", _mock_api_post({"operation_id": "op1"})):
            resp = client.post("/flagship/api/backups/trigger", json={"instance_id": "i1"})
            assert resp.status_code == 200

    def test_restore_missing_fields(self, client):
        resp = client.post("/flagship/api/backups/restore", json={})
        assert resp.status_code == 400
        resp = client.post("/flagship/api/backups/restore", json={"backup_id": "b1"})
        assert resp.status_code == 400

    def test_restore_backup(self, client):
        with patch("app.bff.backups.api_post", _mock_api_post({"operation_id": "op1"})):
            resp = client.post("/flagship/api/backups/restore", json={"backup_id": "b1", "target_app_id": "i2"})
            assert resp.status_code == 200


class TestBFFJobs:
    def test_list_jobs(self, client):
        with patch("app.bff.jobs.api_get", _mock_api_get({"items": [{"id": "j1"}], "page": 1, "page_size": 20, "total": 1})):
            resp = client.get("/flagship/api/jobs")
            assert resp.status_code == 200
            assert resp.json["jobs"][0]["id"] == "j1"
            assert resp.json["page_size"] == 20

    def test_list_jobs_status_filter(self, client):
        with patch("app.bff.jobs.api_get", _mock_api_get([
            {"id": "j1", "status": "failed"},
            {"id": "j2", "status": "completed"},
        ])):
            resp = client.get("/flagship/api/jobs?status=failed")
            assert resp.status_code == 200
            assert len(resp.json["jobs"]) == 1
            assert resp.json["jobs"][0]["id"] == "j1"

    def test_list_jobs_failure(self, client):
        with patch("app.bff.jobs.api_get", _mock_api_get_failure()):
            resp = client.get("/flagship/api/jobs")
            assert resp.status_code == 502

    def test_job_detail(self, client):
        with patch("app.bff.jobs.api_get", _mock_api_get({"id": "j1"})):
            resp = client.get("/flagship/api/jobs/j1")
            assert resp.status_code == 200





class TestBFFBackupDetail:
    def test_backup_detail(self, client):
        with patch("app.bff.backups.api_get", _mock_api_get({"id": "b1", "status": "completed"})):
            resp = client.get("/flagship/api/backups/b1")
            assert resp.status_code == 200
            assert resp.json["backup"]["id"] == "b1"

    def test_backup_detail_failure(self, client):
        with patch("app.bff.backups.api_get", _mock_api_get_failure()):
            resp = client.get("/flagship/api/backups/b1")
            assert resp.status_code == 502


class TestBFFBackupSettings:
    def test_backup_settings(self, client):
        with patch("app.bff.backups.api_get", _mock_api_get({"storage_backend": "s3", "bucket": "admiral-backups"})):
            resp = client.get("/flagship/api/backups/settings")
            assert resp.status_code == 200
            assert resp.json["storage_backend"] == "s3"

    def test_backup_settings_failure(self, client):
        with patch("app.bff.backups.api_get", _mock_api_get_failure()):
            resp = client.get("/flagship/api/backups/settings")
            assert resp.status_code == 502


class TestBFFBackupPrune:
    def test_prune_backups(self, client):
        with patch("app.bff.backups.api_post", _mock_api_post({"success": True, "pruned_backups_count": 2})):
            resp = client.post("/flagship/api/backups/prune")
            assert resp.status_code == 200
            assert resp.json["pruned_backups_count"] == 2

    def test_prune_backups_failure(self, client):
        with patch("app.bff.backups.api_post", _mock_api_post_failure()):
            resp = client.post("/flagship/api/backups/prune")
            assert resp.status_code == 502


class TestBFFBackupDelete:
    def test_delete_backup(self, client):
        with patch("app.bff.backups.api_delete", _mock_api_delete({"success": True})):
            resp = client.delete("/flagship/api/backups/b1")
            assert resp.status_code == 200
            assert resp.json["success"] is True

    def test_delete_backup_failure(self, client):
        with patch("app.bff.backups.api_delete", _mock_api_delete_failure()):
            resp = client.delete("/flagship/api/backups/b1")
            assert resp.status_code == 502


class TestBFFBackupVolumeTrigger:
    def test_trigger_volume_backup(self, client):
        with patch("app.bff.backups.api_post", _mock_api_post({"operation_id": "op1"})):
            resp = client.post("/flagship/api/backups/trigger", json={"instance_id": "i1", "kind": "volumes"})
            assert resp.status_code == 200
            assert resp.json["operation_id"] == "op1"

    def test_trigger_volume_backup_invalid_kind(self, client):
        resp = client.post("/flagship/api/backups/trigger", json={"instance_id": "i1", "kind": "invalid"})
        assert resp.status_code == 400


class TestBFFNodeRegister:
    def test_register_node(self, client):
        with patch("app.bff.nodes.api_post", _mock_api_post({"success": True, "node_id": "n1"})):
            resp = client.post("/flagship/api/nodes/register", json={
                "node_id": "n1",
                "hostname": "worker-1",
                "ip": "10.0.0.1"
            })
            assert resp.status_code == 200
            assert resp.json["node_id"] == "n1"

    def test_register_node_failure(self, client):
        with patch("app.bff.nodes.api_post", _mock_api_post_failure()):
            resp = client.post("/flagship/api/nodes/register", json={
                "node_id": "n1",
                "hostname": "worker-1",
                "ip": "10.0.0.1"
            })
            assert resp.status_code == 502


class TestBFFInstanceTiersAndOps:
    def test_instance_tiers(self, client):
        def mock_get(path):
            if "/instances/" in path and "/tiers" not in path and "/operations" not in path:
                return {"id": "i1", "app_id": "whoami", "tier_id": "starter"}
            if "apps/" in path and "/tiers" in path:
                return [{"name": "starter", "cpu": 0.5, "memory": "512Mi", "storage": "5Gi"}]
            return {}
        with patch("app.bff.instances.api_get", mock_get):
            resp = client.get("/flagship/api/instances/i1/tiers")
            assert resp.status_code == 200
            assert resp.json["tiers"][0]["name"] == "starter"

    def test_instance_tiers_failure(self, client):
        with patch("app.bff.instances.api_get", _mock_api_get_failure()):
            resp = client.get("/flagship/api/instances/i1/tiers")
            assert resp.status_code == 502

    def test_instance_operations(self, client):
        with patch("app.bff.instances.api_get", _mock_api_get({"items": [{"id": "op1", "action": "provision", "instance_id": "i1"}]})):
            resp = client.get("/flagship/api/instances/i1/operations")
            assert resp.status_code == 200
            assert resp.json["operations"][0]["id"] == "op1"

    def test_instance_operations_failure(self, client):
        with patch("app.bff.instances.api_get", _mock_api_get_failure()):
            resp = client.get("/flagship/api/instances/i1/operations")
            assert resp.status_code == 502


