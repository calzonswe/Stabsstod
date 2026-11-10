#!/bin/sh
set -e

echo "==> API health over HTTPS..."
curl -sk https://localhost/api/health | grep '"ok":true' >/dev/null

echo "==> Web app over HTTPS..."
curl -sk https://localhost/ | grep -q 'Stabsstöd'

echo "OK: smoke test passed"
