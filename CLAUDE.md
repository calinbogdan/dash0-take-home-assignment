# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

This is a **log ingestion service** take-home assignment. The service receives batches of structured log entries over HTTP, authenticates clients via API key (Bearer token), rate-limits per key, queues logs asynchronously, and processes them with a background worker. OpenTelemetry tracing via Dash0 is required.

All work lives in the `nodejs/` directory.

## Commands

Run from `nodejs/`:

```bash
pnpm install       # install dependencies
pnpm dev           # run with hot reload (tsx watch)
pnpm start         # run without hot reload
pnpm test          # run tests once
pnpm test:watch    # run tests in watch mode
```

To run a single test file:
```bash
pnpm vitest run src/some.test.ts
```

## Architecture

- [src/index.ts](nodejs/src/index.ts) — entry point; starts the HTTP server
- [src/app.ts](nodejs/src/app.ts) — Express app factory (`createApp()`); add routes here
- [src/config.ts](nodejs/src/config.ts) — typed config object built from `process.env`; extend this for new env vars (e.g. API keys, worker concurrency, Dash0 endpoint)

### Design constraints from the spec

- **Auth**: API keys stored in-memory but abstracted so a persistent store can be swapped in.
- **Rate limiter**: per-API-key, in-memory, max 10 req/s.
- **Queue**: internal in-process queue; `POST /logs/json` pushes entries onto it.
- **Worker**: drains the queue concurrently (configurable limit, default 5); each entry is logged to stdout; simulated processing delay; retries up to 3 times on failure.
- **Tracing**: OpenTelemetry SDK (`@opentelemetry/sdk-node`), Dash0 OTLP exporter; child span per log entry with attributes `log.level`, `log.service`, `queue.depth`, `worker.retry_count`; spans marked as error on failure with exception recorded.

### Log entry schema

```json
{
  "timestamp": "2024-11-01T12:00:00Z",
  "level": "error",
  "message": "Disk usage above 90%",
  "meta": { "host": "prod-server-1", "service": "disk-monitor" }
}
```

## Tech stack

- **Runtime**: Node.js with TypeScript (`tsx` for dev, `tsc` target ES2022/CommonJS)
- **Framework**: Express 4
- **Test runner**: Vitest (globals enabled, node environment)
- **Package manager**: pnpm
