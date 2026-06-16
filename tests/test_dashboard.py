# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

from unittest.mock import patch


def test_dashboard_aggregation(client):
    with patch(
        "app.bff.dashboard.api_get",
        side_effect=[
            [{"id": "n1", "status": "online"}, {"id": "n2", "status": "offline"}],
            [{"id": "i1", "status": "running"}, {"id": "i2", "status": "error"}],
            [
                {
                    "id": "o1",
                    "status": "failed",
                    "created_at": "2026-06-06T10:00:00Z",
                    "updated_at": "2026-06-06T10:05:00Z",
                }
            ],
            [{"id": "b1", "status": "failed"}],
        ],
    ):
        response = client.get("/flagship/api/dashboard")
        assert response.status_code == 200
        assert response.json["summary"]["total_nodes"] == 2
        assert response.json["summary"]["active_nodes"] == 1
        assert response.json["summary"]["offline_nodes"] == 1
        assert response.json["summary"]["total_instances"] == 2
        assert response.json["summary"]["error_instances"] == 1
        assert response.json["summary"]["jobs"] == 1
        assert response.json["summary"]["failed_jobs"] == 1
        assert response.json["summary"]["failed_backups"] == 1
        assert response.json["alerts"][0]["target"] == "/nodes?status=offline"
        assert response.json["recent_jobs"][0]["duration_seconds"] == 300


def test_dashboard_handles_non_list_payloads(client):
    with patch(
        "app.bff.dashboard.api_get",
        side_effect=[
            {"items": [{"id": "n1", "status": "active"}]},
            {"data": [{"id": "i1", "status": "paused"}]},
            [{"id": "o1", "status": "failed"}],
            {"data": [{"id": "b1"}]},
        ],
    ):
        response = client.get("/flagship/api/dashboard")
        assert response.status_code == 200
        assert response.json["summary"]["total_nodes"] == 1
        assert response.json["summary"]["paused_instances"] == 1


def test_dashboard_counts_billing_states(client):
    with patch(
        "app.bff.dashboard.api_get",
        side_effect=[
            [{"id": "n1", "status": "active"}],
            [{"id": "i1", "status": "past_due"}, {"id": "i2", "status": "suspended"}],
            [{"id": "o1", "status": "failed"}],
            [{"id": "b1"}],
        ],
    ):
        response = client.get("/flagship/api/dashboard")
        assert response.status_code == 200
        assert response.json["summary"]["past_due_instances"] == 1
        assert response.json["summary"]["suspended_instances"] == 1


def test_dashboard_exposes_failed_backup_diagnostics(client):
    with patch(
        "app.bff.dashboard.api_get",
        side_effect=[
            [{"id": "n1", "status": "online"}],
            [{"id": "i1", "status": "running"}],
            [{"id": "o1", "status": "completed"}],
            [{"id": "b1", "status": "failed", "error_message": "checksum mismatch"}],
        ],
    ):
        response = client.get("/flagship/api/dashboard")
        assert response.status_code == 200
        assert response.json["recent_failed_backups"][0]["detail_path"] == "/backups/b1"
        assert (
            response.json["recent_failed_backups"][0]["error_message"]
            == "checksum mismatch"
        )
