#!/usr/bin/env bash
# Manual smoke test for Task 1 (see docs/superpowers/plans/2026-09-08-equipment-ledger-implementation.md, Step 6).
# Assumes `docker compose up -d` and `npm run dev` are already running.
set -euo pipefail

echo "== Mongo replica set status =="
STATE=$(docker compose exec -T mongo mongosh --quiet --eval "rs.status().myState")
echo "myState=$STATE"
if [ "$STATE" != "1" ]; then
  echo "WARNING: expected myState=1 (PRIMARY); replica set may still be electing. Retry in a few seconds."
fi

echo "== Web app (http://localhost:3000) =="
curl -sf http://localhost:3000 | grep -q "Equipment Ledger" \
  && echo "OK: page contains 'Equipment Ledger'" \
  || echo "FAIL: expected text not found"

echo "== API (http://localhost:4000) =="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4000
echo "(expect 404 - no routes registered yet)"
