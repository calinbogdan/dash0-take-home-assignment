import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { LogEntry, LogQueue } from './queue';

export type Processor = (entry: LogEntry, retryCount: number) => Promise<void>;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const tracer = trace.getTracer('log-worker');

export async function processWithRetry(
    entry: LogEntry,
    processor: Processor,
    queueDepth: number,
    maxRetries = 3,
): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const span = tracer.startSpan('processLog');
        span.setAttributes({
            'log.level': entry.level,
            'log.service': entry.meta.service ?? '',
            'queue.depth': queueDepth,
            'worker.retry_count': attempt,
        });
        try {
            await context.with(trace.setSpan(context.active(), span), () =>
                processor(entry, attempt),
            );
            span.end();
            return;
        } catch (err) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
            span.recordException(err as Error);
            span.end();
            if (attempt === maxRetries) {
                console.error(JSON.stringify({
                    level: 'error',
                    message: 'Log entry failed after max retries',
                    entry,
                    error: String(err),
                }));
            }
        }
    }
}

export function startWorker(
    queue: LogQueue,
    concurrency: number,
    processor: Processor,
): () => void {
    let running = true;

    async function workerLoop(): Promise<void> {
        while (running) {
            const entry = queue.dequeue(); // synchronous claim before any await
            if (entry) {
                const depth = queue.size;
                await processWithRetry(entry, processor, depth);
            } else {
                await sleep(50);
            }
        }
    }

    for (let i = 0; i < concurrency; i++) {
        workerLoop().catch(err =>
            console.error(JSON.stringify({ level: 'error', message: 'Worker crashed', error: String(err) }))
        );
    }

    return () => { running = false; };
}

export function createLogProcessor(processingDelayMs: number, failureRate = 0): Processor {
    return async (entry: LogEntry, retryCount: number) => {
        await sleep(processingDelayMs);
        if (failureRate > 0 && Math.random() < failureRate) {
            throw new Error(`Simulated failure (rate=${failureRate})`);
        }
        console.log(JSON.stringify({
            timestamp: entry.timestamp,
            level: entry.level,
            message: entry.message,
            meta: entry.meta,
            worker: { retryCount },
        }));
    };
}
