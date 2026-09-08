#!/usr/bin/env bash
set -euo pipefail

STATUS=$(mongosh --host mongo --quiet --eval "try { rs.status().ok } catch (e) { 0 }")

if [ "$STATUS" != "1" ]; then
  echo "Initiating replica set rs0..."
  mongosh --host mongo --quiet --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'mongo:27017'}]})"
else
  echo "Replica set rs0 already initiated."
fi
