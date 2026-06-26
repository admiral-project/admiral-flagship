# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import pytest
import time
from app import create_app


@pytest.fixture
def app():
    app = create_app()
    app.config.update(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret",
            "ADMIRAL_API_URL": "https://admirald.test:8080",
            "ADMIRAL_ADMIN_TOKEN": "test-token",
            "ADMIRAL_CA_FILE": "",
        }
    )
    return app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def runner(app):
    return app.test_cli_runner()


@pytest.fixture(autouse=True)
def auto_session(request, client):
    # Auto-login for BFF and Dashboard tests since they expect an authenticated session
    if request.module and ("test_bff" in request.module.__name__ or "test_dashboard" in request.module.__name__):
        with client.session_transaction() as sess:
            sess["admin_token"] = "test-admin-token"
            sess["admin_username"] = "admin"
            sess["session_started_at"] = int(time.time())
