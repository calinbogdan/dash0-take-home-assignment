#!/usr/bin/env bash
# Fires 15 rapid requests with the same API key.
# Requests 11-15 should receive 429 Too Many Requests (limit is 10 req/s).

HOST="${HOST:-http://localhost:3003}"
API_KEY="${API_KEY:-secret-key-1}"

PAYLOAD='[{
  "timestamp": "2024-11-01T14:00:00Z",
  "level": "info",
  "message": "Rate limit probe",
  "meta": { "host": "test-client", "service": "rate-limit-test" }
}]'

for i in $(seq 1 15); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$HOST/logs/json" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")
  echo "Request $i → HTTP $STATUS"
done
