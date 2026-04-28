import { z } from 'zod';

export const LogEntrySchema = z.object({
    timestamp: z.string().datetime(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().min(1),
    meta: z.object({
        host: z.string(),
        service: z.string(),
    }),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;
export const LogBatchSchema = z.array(LogEntrySchema).min(1);

export class LogQueue {
    private items: LogEntry[] = [];

    enqueue(...entries: LogEntry[]): void {
        this.items.push(...entries);
    }

    // Synchronous claim — safe for concurrent async workers in Node.js
    // because shift() completes before any await yields control.
    dequeue(): LogEntry | undefined {
        return this.items.shift();
    }

    get size(): number {
        return this.items.length;
    }
}
