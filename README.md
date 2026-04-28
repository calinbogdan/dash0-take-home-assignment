```
█████               ██████████
█████████       ██████████████████
███████████   ██████████████████████
████████████ ████████████████████████
████████████ ████████████████████████
████████████ ████████████████████████
████████████ ████████████████████████
████████████ ████████████████████████
███████████   ██████████████████████
█████████       ██████████████████
█████               ██████████
```

# Log ingestion service

A Node.js HTTP service that accepts batches of structured log entries, authenticates clients via API key, rate-limits per key, queues entries asynchronously, and processes them with a pool of background workers — all instrumented with OpenTelemetry and exporting traces to [Dash0](https://dash0.com).

## Overview

Clients (agents on customer infrastructure) `POST /logs/json` with an array of log records. The service authenticates the request with a Bearer token, applies a per-key rate limit, validates the payload, and pushes valid entries onto an in-process queue. A configurable pool of workers drains the queue concurrently, simulates a processing delay, retries up to three times on failure, and writes the processed entry as structured JSON to stdout. Each processing attempt produces an OpenTelemetry span exported via OTLP/proto.

The original assignment prompt lives at [`nodejs/README.md`](nodejs/README.md) and is the source of truth for the requirements. This document describes what was built, why each decision was made, what would change in production, and the assumptions made along the way.

All code lives under [`nodejs/`](nodejs/).

## Repository layout

| File | Responsibility |
| --- | --- |
| [`nodejs/src/index.ts`](nodejs/src/index.ts) | Bootstrap: imports tracing first, wires dependencies, starts workers and HTTP server. |
| [`nodejs/src/app.ts`](nodejs/src/app.ts) | Express app factory `createApp(store, limiter, queue)` and the `POST /logs/json` route. |
| [`nodejs/src/auth.ts`](nodejs/src/auth.ts) | `ApiKeyStore` interface, `InMemoryApiKeyStore`, and the `authenticate()` middleware. |
| [`nodejs/src/rateLimiter.ts`](nodejs/src/rateLimiter.ts) | `RateLimiter` interface, `SlidingWindowRateLimiter`, and the `rateLimit()` middleware. |
| [`nodejs/src/queue.ts`](nodejs/src/queue.ts) | Zod schemas (`LogEntrySchema`, `LogBatchSchema`) and the in-memory `LogQueue`. |
| [`nodejs/src/worker.ts`](nodejs/src/worker.ts) | `startWorker()`, `processWithRetry()`, and the simulated `createLogProcessor()`. |
| [`nodejs/src/tracing.ts`](nodejs/src/tracing.ts) | OpenTelemetry NodeSDK + OTLP/proto trace exporter. |
| [`nodejs/src/config.ts`](nodejs/src/config.ts) | Typed config built from `process.env` with defaults. |
| [`nodejs/src/app.test.ts`](nodejs/src/app.test.ts) | Supertest-based integration tests for auth, validation, and rate limiting. |
| [`nodejs/src/worker.test.ts`](nodejs/src/worker.test.ts) | Vitest unit tests for retry behaviour and concurrent dequeuing. |
| [`nodejs/scripts/`](nodejs/scripts/) | Manual smoke-test scripts (`send-logs.sh`, `send-errors.sh`, `rate-limit-test.sh`). |

## Getting started

All commands run from `nodejs/`:

```bash
pnpm install       # install dependencies
pnpm dev           # run with hot reload (tsx watch)
pnpm start         # run without hot reload
pnpm test          # run the test suite once
pnpm test:watch    # run tests in watch mode
```

### Configuration

Environment variables consumed by [`config.ts`](nodejs/src/config.ts) and [`tracing.ts`](nodejs/src/tracing.ts):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3003` | HTTP listen port. |
| `API_KEYS` | _(empty)_ | Comma-separated list of accepted Bearer tokens. |
| `RATE_LIMIT_PER_SECOND` | `10` | Max requests per API key per second. |
| `WORKER_CONCURRENCY` | `5` | Number of worker loops draining the queue. |
| `PROCESSING_DELAY_MS` | `100` | Simulated work per log entry. |
| `FAILURE_RATE` | `0` | Probability (0–1) that a processing attempt throws. Used to exercise the retry path. |
| `OTEL_SERVICE_NAME` | `log-ingestion-service` | Service name attached to every span. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(SDK default)_ | OTLP/proto endpoint, e.g. your Dash0 ingress URL. |
| `OTEL_EXPORTER_OTLP_HEADERS` | _(none)_ | Standard OTel header for the Dash0 auth token, e.g. `Authorization=Bearer ...`. |

A `.env` file at `nodejs/.env` is loaded automatically (`dotenv/config` is the first import in [`index.ts`](nodejs/src/index.ts)).

### Manual smoke tests

The shell scripts in [`nodejs/scripts/`](nodejs/scripts/) hit a running service with `curl`: `send-logs.sh` posts a mixed batch, `send-errors.sh` posts only error-level entries, and `rate-limit-test.sh` fires bursts to confirm `429` behaviour.

## Design decisions

Each subsection states what was built, why, and the alternative that was considered.

### Auth abstracted behind an interface

[`auth.ts`](nodejs/src/auth.ts) defines an `ApiKeyStore` interface with a single async `validate(key)` method, plus an `InMemoryApiKeyStore` backed by a `Set<string>`. The `authenticate()` middleware extracts the Bearer token, calls `store.validate()`, and returns `401` for any failure mode (missing header, wrong scheme, unknown key) without leaking which case fired.

The interface makes it a one-liner to swap in a database- or service-backed store later — the spec calls this out explicitly. `validate()` returns a `Promise<boolean>` even though the in-memory implementation is synchronous, so the middleware contract doesn't need to change when that swap happens.

The alternative — coupling the middleware directly to a `Set` lookup — would have been simpler today but would force every future store change to also touch `app.ts`.

### Sliding-window rate limiter, per API key

[`rateLimiter.ts`](nodejs/src/rateLimiter.ts) implements `SlidingWindowRateLimiter`: a `Map<apiKey, number[]>` of recent request timestamps, evaluated on every call. A request is allowed if either the window has fewer than `maxPerSecond` entries, or its oldest entry has fallen outside the 1-second window. The middleware returns `429` with a ceiling-rounded `Retry-After` header on rejection.

Sliding window was preferred over a simple fixed-window counter because fixed windows let a client send `2 × max` requests across the boundary between two windows. Token bucket would also have worked, but a sliding window was a closer match to the literal "max 10 requests/second" wording in the spec and is easy to reason about when reviewing tests.

The middleware deliberately runs **after** authentication so unauthenticated traffic doesn't consume any quota. The result type is a discriminated union (`{ allowed: true } | { allowed: false; retryAfterMs }`) so the caller can't forget to read `retryAfterMs`.

### Validation with Zod at the HTTP boundary

[`queue.ts`](nodejs/src/queue.ts) declares the schema once: `LogEntrySchema` (ISO-8601 timestamp, enum level, non-empty message, `meta` with `host` and `service`) and `LogBatchSchema` (array with `min(1)`). The TypeScript `LogEntry` type is `z.infer<typeof LogEntrySchema>`, so the runtime schema and the static type can never drift.

Validation happens in [`app.ts`](nodejs/src/app.ts) via `safeParse`. On failure the route returns `400` with a flattened error tree, on success it `enqueue`s the whole batch and returns `202 Accepted` with a `{ queued: N }` body. The downstream `LogQueue` and worker treat entries as already-validated `LogEntry` values — no defensive re-checks.

The alternative — duplicate runtime checks in the worker — would have been wasted work since we trust the only producer.

### In-process FIFO queue

[`LogQueue`](nodejs/src/queue.ts) is a plain `LogEntry[]` with `enqueue(...entries)` (push) and `dequeue()` (shift). A short comment in the code calls out the key invariant: `Array.prototype.shift()` is synchronous, and Node's single-threaded event loop guarantees no other worker can race on it before the current one `await`s. That's enough mutual exclusion without introducing a lock.

The trade-off — no persistence, no horizontal scale, no bound — is intentional for an in-memory exercise. See "What I'd do differently" below for the production replacements.

### Worker pool of N parallel async loops

[`startWorker()`](nodejs/src/worker.ts) spawns `concurrency` independent `workerLoop()` promises that each call `queue.dequeue()` synchronously, claim an entry, and process it. When the queue is empty they `sleep(50)` and try again. Each loop is wrapped in `.catch` at the top level so a crash in one loop doesn't tear down the whole pool — the failure is logged as structured JSON, but the rest of the pool keeps draining the queue.

This is simpler than a third-party concurrency library and matches the spec's "max 5 at a time" requirement directly. The 50 ms idle sleep is a deliberate compromise: short enough that latency stays low, long enough that an empty queue doesn't burn CPU.

### Retries: linear, max 3, exception-swallowing

[`processWithRetry()`](nodejs/src/worker.ts) loops up to `maxRetries + 1` times (defaults to 4 attempts total). On success it ends the span and returns; on failure it sets `SpanStatusCode.ERROR`, calls `span.recordException`, ends the span, and retries. After the final failure it logs an `error`-level JSON line to stderr and returns normally — it never throws back into the worker loop.

Swallowing the final exception is deliberate: the worker loop must keep draining other entries even when one is poisoned. The HTTP side already returned `202 Accepted`, so the client is decoupled from processing outcomes. Retries are linear (no backoff) because the simulated processor is the only failure source in scope — real backoff is listed below as a production gap.

### OpenTelemetry initialised before everything else

[`tracing.ts`](nodejs/src/tracing.ts) starts the NodeSDK with an OTLP/proto trace exporter at module load time, and registers a `SIGTERM` shutdown hook to flush in-flight spans. Crucially, [`index.ts`](nodejs/src/index.ts) imports `./tracing` on **line 2**, before Express, the queue, or the worker. This ordering is what lets the SDK auto-instrument `http`, `express`, and friends.

The worker creates a manual span named `processLog` per entry per attempt, with attributes `log.level`, `log.service`, `queue.depth`, `worker.retry_count` — the exact set the spec asks for. The processor runs inside `context.with(trace.setSpan(...))` so any nested instrumentation links to the correct parent.

OTLP/proto over the standard env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`) is enough to talk to Dash0; no Dash0-specific code is required.

### Configuration as a single typed object

[`config.ts`](nodejs/src/config.ts) exports one frozen `config` object built from `process.env` with sensible defaults. Two of the entries — `processingDelayMs` and `failureRate` — exist purely so tests and demos can exercise the retry path without code changes. They're a feature, not leakage.

### Tests

- [`app.test.ts`](nodejs/src/app.test.ts) uses Supertest to drive `createApp()` end-to-end and covers authentication (missing / wrong scheme / unknown key), validation (empty array, missing fields, bad enum, empty message, missing meta, single-entry happy path, multi-entry happy path), and rate limiting (allow up to N, deny N+1 with `Retry-After`, per-key isolation).
- [`worker.test.ts`](nodejs/src/worker.test.ts) uses Vitest's `vi.fn()` to drive `processWithRetry` and `startWorker` deterministically: success on first attempt, transient failure then success, exhaustion after max retries, single-worker drain, fair concurrent drain across five workers, and continued progress after a processor failure.

Dependency injection across the codebase (`createApp`, `startWorker`) is what makes both layers cheap to test in isolation.

## What I'd do differently in production / with more time

In rough priority order:

- **Persistent, distributed queue.** Redis Streams, Kafka, or SQS — so entries survive restarts, multiple instances share work, and we don't OOM under load.
- **Distributed rate limiter.** A Redis-backed token bucket so limits hold across instances. The current per-process limit becomes meaningless behind a load balancer.
- **Persistent `ApiKeyStore`.** A database-backed implementation with hashed keys, scopes, rotation, and revocation. The interface already supports this — only the implementation needs to change.
- **Backpressure.** Bound the queue and respond `429`/`503` from the HTTP side when full, instead of accepting unbounded enqueues. Pair with an `express.json()` body-size limit and a per-batch entry-count cap.
- **Exponential backoff with jitter** on retries, and a dead-letter destination for poison entries so they can be inspected and replayed.
- **Graceful shutdown.** On SIGINT/SIGTERM: stop accepting new requests, drain the queue (with a deadline), then `sdk.shutdown()` to flush traces. Currently only SIGTERM is handled and only for the OTel SDK.
- **Auth hardening.** Audit-log failed authentication attempts, rate-limit failed-auth specifically (today the limiter only kicks in after auth succeeds), constant-time key comparison.
- **Trace sampling.** 100% sampling is fine for an exercise but expensive at real volume — head-based sampling at the SDK and tail-based at a collector.
- **Metrics, not just traces.** Queue-depth gauge, processed/failed counters, p99 processing latency, plus a `/healthz` and `/readyz` endpoint.
- **Event-driven worker.** Replace polling-with-sleep with an event emitter on the queue so workers wake up immediately when items arrive, eliminating the 50 ms idle-latency floor.
- **Stronger schema.** Allow extra `meta` fields, validate timestamp drift (reject logs from the far future), and propagate incoming `traceparent` headers so a client's trace links to ours.
- **A real logger.** Swap `console.log(JSON.stringify(...))` for pino — it's faster, handles error serialisation correctly, and supports log levels/redaction.
- **CI.** Lint, typecheck, and test on every PR; a container image build; an integration test that spins up a real OTLP collector and asserts spans are exported.

## Assumptions

These are the working assumptions the implementation is built on. If any are wrong the design changes:

- API keys are opaque strings supplied as a comma-separated list in `API_KEYS`. No scopes, tenants, or per-key rate-limit overrides are required.
- The rate limit is per API key, not per IP or globally. The spec's "10 req/s" example is the default but is configurable.
- "Process the log" means write structured JSON to stdout after a configurable delay. Anything richer (forwarding, indexing, alerting) is out of scope.
- A single in-process queue is acceptable. Horizontal scale and persistence aren't required for the exercise.
- `202 Accepted` is the right contract for `POST /logs/json` because processing is asynchronous — the client is told the batch was queued, not that every entry was successfully processed.
- Validation is fail-closed on the whole batch: one bad entry rejects the whole array. Partial-success was rejected as harder to reason about for clients.
- The `meta` object has exactly `host` and `service`, matching the example payload. Unknown fields are rejected by Zod's strict-by-default behaviour.
- Dash0 is reachable via the standard OTel OTLP env vars (`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` carrying the auth token). No Dash0-specific code is needed because the OTLP/proto exporter speaks the standard wire format.
- Failures are transient. Retrying the same entry up to three times is the right policy; a poison-pill DLQ is out of scope.
- Target runtime is Node.js 20+ with pnpm, matching the versions pinned in [`package.json`](nodejs/package.json).
