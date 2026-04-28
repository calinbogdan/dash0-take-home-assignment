#!/usr/bin/env bash
# Sends a mixed batch of log entries across levels and services.

HOST="${HOST:-http://localhost:3003}"
API_KEY="${API_KEY:-secret-key-1}"

curl -s -w "\n\nHTTP %{http_code}\n" \
  -X POST "$HOST/logs/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "timestamp": "2024-11-01T12:00:00Z",
      "level": "info",
      "message": "User login successful",
      "meta": { "host": "auth-server-1", "service": "auth" }
    },
    {
      "timestamp": "2024-11-01T12:00:01Z",
      "level": "warn",
      "message": "High memory usage detected",
      "meta": { "host": "app-server-2", "service": "api-gateway" }
    },
    {
      "timestamp": "2024-11-01T12:00:02Z",
      "level": "error",
      "message": "Database connection timeout",
      "meta": { "host": "db-server-1", "service": "postgres" }
    },
    {
      "timestamp": "2024-11-01T12:00:03Z",
      "level": "debug",
      "message": "Cache miss for key user:42",
      "meta": { "host": "cache-server-1", "service": "redis-cache" }
    },
    {
      "timestamp": "2024-11-01T12:00:04Z",
      "level": "info",
      "message": "Scheduled job completed",
      "meta": { "host": "worker-1", "service": "job-scheduler" }
    }
  ]'
