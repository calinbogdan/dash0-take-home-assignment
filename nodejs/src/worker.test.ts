import { describe, it, expect, vi } from 'vitest';
import { processWithRetry, startWorker, Processor } from './worker';
import { LogQueue, LogEntry } from './queue';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const ENTRY: LogEntry = {
    timestamp: '2024-11-01T12:00:00Z',
    level: 'error',
    message: 'Disk usage above 90%',
    meta: { host: 'prod-server-1', service: 'disk-monitor' },
};

describe('processWithRetry', () => {
    it('calls the processor once on success', async () => {
        const processor = vi.fn<Parameters<Processor>, ReturnType<Processor>>().mockResolvedValue(undefined);
        await processWithRetry(ENTRY, processor, 0);
        expect(processor).toHaveBeenCalledTimes(1);
        expect(processor).toHaveBeenCalledWith(ENTRY, 0);
    });

    it('retries after a failure and succeeds on the second attempt', async () => {
        const processor = vi.fn<Parameters<Processor>, ReturnType<Processor>>()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue(undefined);
        await processWithRetry(ENTRY, processor, 0);
        expect(processor).toHaveBeenCalledTimes(2);
        expect(processor).toHaveBeenNthCalledWith(2, ENTRY, 1);
    });

    it('gives up after 3 retries (4 total attempts)', async () => {
        const processor = vi.fn<Parameters<Processor>, ReturnType<Processor>>().mockRejectedValue(new Error('always fails'));
        await processWithRetry(ENTRY, processor, 0);
        expect(processor).toHaveBeenCalledTimes(4);
    });
});

describe('startWorker', () => {
    it('processes items from the queue', async () => {
        const queue = new LogQueue();
        queue.enqueue(ENTRY);

        const processed: LogEntry[] = [];
        const processor = vi.fn<Parameters<Processor>, ReturnType<Processor>>().mockImplementation(async (entry) => {
            processed.push(entry);
        });

        const stop = startWorker(queue, 1, processor);
        await sleep(20);
        stop();

        expect(processed).toHaveLength(1);
        expect(processed[0]).toEqual(ENTRY);
    });

    it('each item is claimed exactly once across N workers', async () => {
        const queue = new LogQueue();
        const total = 20;
        for (let i = 0; i < total; i++) {
            queue.enqueue({ ...ENTRY, message: `entry-${i}` });
        }

        const processed: string[] = [];
        const processor = vi.fn<Parameters<Processor>, ReturnType<Processor>>().mockImplementation(async (entry) => {
            processed.push(entry.message);
        });

        const stop = startWorker(queue, 5, processor);
        await sleep(50);
        stop();

        expect(processed).toHaveLength(total);
        // every message appears exactly once
        expect(new Set(processed).size).toBe(total);
    });

    it('continues processing after a failure', async () => {
        const queue = new LogQueue();
        queue.enqueue(ENTRY);
        queue.enqueue({ ...ENTRY, message: 'second' });

        const processed: string[] = [];
        const processor = vi.fn<Parameters<Processor>, ReturnType<Processor>>()
            .mockRejectedValueOnce(new Error('first fails'))
            .mockImplementation(async (entry) => { processed.push(entry.message); });

        const stop = startWorker(queue, 1, processor);
        await sleep(20);
        stop();

        expect(processed).toContain('second');
    });
});
