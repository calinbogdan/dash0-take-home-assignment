import express, { Request, Response } from 'express';
import { ApiKeyStore, authenticate } from './auth';
import { RateLimiter, rateLimit } from './rateLimiter';

export function createApp(apiKeyStore: ApiKeyStore, limiter: RateLimiter) {
    const app = express();

    app.use(express.json());

    app.get('/', (_req: Request, res: Response) => {
        res.json({ message: 'Hello World' });
    });

    app.post('/logs/json', authenticate(apiKeyStore), rateLimit(limiter), (_req: Request, res: Response) => {
        res.status(202).json({ message: 'Accepted' });
    });

    return app;
}