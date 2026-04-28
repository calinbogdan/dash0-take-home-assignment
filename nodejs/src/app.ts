import express, { Request, Response } from 'express';
import { ApiKeyStore, authenticate } from './auth';
import { RateLimiter, rateLimit } from './rateLimiter';
import { LogBatchSchema, LogQueue } from './queue';

export function createApp(apiKeyStore: ApiKeyStore, limiter: RateLimiter, queue: LogQueue) {
    const app = express();

    app.use(express.json());

    app.get('/', (_req: Request, res: Response) => {
        res.json({ message: 'Hello World' });
    });

    app.post('/logs/json', authenticate(apiKeyStore), rateLimit(limiter), (req: Request, res: Response) => {
        const result = LogBatchSchema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({ error: result.error.flatten() });
            return;
        }
        queue.enqueue(...result.data);
        res.status(202).json({ queued: result.data.length });
    });

    return app;
}