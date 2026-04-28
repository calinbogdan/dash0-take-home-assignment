import { Request, Response, NextFunction } from 'express';

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

export interface RateLimiter {
    check(key: string): Promise<RateLimitResult>;
}

export class SlidingWindowRateLimiter implements RateLimiter {
    // newest-first; capped at maxPerSecond entries
    private windows = new Map<string, number[]>();

    constructor(private readonly maxPerSecond: number) {}

    async check(key: string): Promise<RateLimitResult> {
        const now = Date.now();
        const timestamps = this.windows.get(key) ?? [];

        if (timestamps.length < this.maxPerSecond) {
            this.windows.set(key, [now, ...timestamps]);
            return { allowed: true };
        }

        const oldest = timestamps[timestamps.length - 1];
        if (now - oldest >= 1_000) {
            // oldest slot has expired — reuse it
            this.windows.set(key, [now, ...timestamps.slice(0, -1)]);
            return { allowed: true };
        }

        return { allowed: false, retryAfterMs: oldest + 1_000 - now };
    }
}

export function rateLimit(limiter: RateLimiter) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        // authenticate() has already validated the token by this point
        const apiKey = req.headers.authorization!.slice(7);
        const result = await limiter.check(apiKey);

        if (!result.allowed) {
            res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
            res.status(429).json({ error: 'Rate limit exceeded' });
            return;
        }

        next();
    };
}
