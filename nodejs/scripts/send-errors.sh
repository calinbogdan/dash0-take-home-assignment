#!/usr/bin/env bash
# Sends a batch of error-level logs from a disk-monitor service.
# Useful for verifying error spans show up correctly in Dash0.

HOST="${HOST:-http://localhost:3003}"
API_KEY="${API_KEY:-secret-key-1}"

curl -s -w "\n\nHTTP %{http_code}\n" \
  -X POST "$HOST/logs/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "timestamp": "2024-11-01T13:00:00Z",
      "level": "error",
      "message": "Disk usage above 90%",
      "meta": { "host": "prod-server-1", "service": "disk-monitor" }
    },
    {
      "timestamp": "2024-11-01T13:00:01Z",
      "level": "error",
      "message": "Disk usage above 95%",
      "meta": { "host": "prod-server-1", "service": "disk-monitor" }
    },
    {
      "timestamp": "2024-11-01T13:00:02Z",
      "level": "error",
      "message": "Out of disk space",
      "meta": { "host": "prod-server-1", "service": "disk-monitor" }
    }
  ]'
