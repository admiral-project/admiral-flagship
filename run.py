# SPDX-FileCopyrightText: William Moreno Reyes CP | MBA
# SPDX-License-Identifier: Apache-2.0

import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    # Default to localhost for safety; allow binding for remote access via env.
    host = os.environ.get("FLAGSHIP_HTTP_ADDR", "127.0.0.1")
    port = int(os.environ.get("FLAGSHIP_HTTP_PORT", "5000"))
    app.run(host=host, port=port, debug=False)
