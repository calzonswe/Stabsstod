#!/bin/sh
set -e

echo "==> API health..."
curl -sf http://127.0.0.1:3000/api/health | grep '"ok":true' >/dev/null

echo "OK: smoke test passed"
