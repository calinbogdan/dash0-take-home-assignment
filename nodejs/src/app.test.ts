import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { InMemoryApiKeyStore } from './auth';
import { SlidingWindowRateLimiter } from './rateLimiter';
import { LogQueue } from './queue';

const VALID_KEY = 'test-key-123';
const VALID_ENTRY = {
    timestamp: '2024-11-01T12:00:00Z',
    level: 'error',
    message: 'Disk usage above 90%',
    meta: { host: 'prod-server-1', service: 'disk-monitor' },
};

function makeApp(keys: string[] = [VALID_KEY], maxPerSecond = 10, queue = new LogQueue()) {
    const limiter = new SlidingWindowRateLimiter(maxPerSecond);
    return createApp(new InMemoryApiKeyStore(keys), limiter, queue);
}

function authed(app: ReturnType<typeof makeApp>) {
    return request(app).post('/logs/json').set('Authorization', `Bearer ${VALID_KEY}`);
}

describe('GET /', () => {
    it('responds without an API key', async () => {
        const res = await request(makeApp()).get('/');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ message: 'Hello World' });
    });
});

describe('POST /logs/json — auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
        const res = await request(makeApp()).post('/logs/json').send([VALID_ENTRY]);
        expect(res.status).toBe(401);
    });

    it('returns 401 when the header is not a Bearer token', async () => {
        const res = await request(makeApp())
            .post('/logs/json')
            .set('Authorization', 'Basic sometoken')
            .send([VALID_ENTRY]);
        expect(res.status).toBe(401);
    });

    it('returns 401 when the API key is invalid', async () => {
        const res = await request(makeApp())
            .post('/logs/json')
            .set('Authorization', 'Bearer wrong-key')
            .send([VALID_ENTRY]);
        expect(res.status).toBe(401);
    });

    it('returns 401 when the store has no keys configured', async () => {
        const res = await request(makeApp([]))
            .post('/logs/json')
            .set('Authorization', `Bearer ${VALID_KEY}`)
            .send([VALID_ENTRY]);
        expect(res.status).toBe(401);
    });
});

describe('POST /logs/json — validation', () => {
    it('returns 400 for an empty array', async () => {
        const res = await authed(makeApp()).send([]);
        expect(res.status).toBe(400);
    });

    it('returns 400 when timestamp is missing', async () => {
        const { timestamp: _, ...noTimestamp } = VALID_ENTRY;
        const res = await authed(makeApp()).send([noTimestamp]);
        expect(res.status).toBe(400);
    });

    it('returns 400 when level is not a valid enum value', async () => {
        const res = await authed(makeApp()).send([{ ...VALID_ENTRY, level: 'critical' }]);
        expect(res.status).toBe(400);
    });

    it('returns 400 when message is empty', async () => {
        const res = await authed(makeApp()).send([{ ...VALID_ENTRY, message: '' }]);
        expect(res.status).toBe(400);
    });

    it('returns 400 when meta is missing', async () => {
        const { meta: _, ...noMeta } = VALID_ENTRY;
        const res = await authed(makeApp()).send([noMeta]);
        expect(res.status).toBe(400);
    });

    it('returns 202 and queues valid entries', async () => {
        const queue = new LogQueue();
        const res = await authed(makeApp([VALID_KEY], 10, queue)).send([VALID_ENTRY]);
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ queued: 1 });
        expect(queue.size).toBe(1);
        expect(queue.dequeue()!.message).toBe(VALID_ENTRY.message);
    });

    it('queues multiple entries in one batch', async () => {
        const queue = new LogQueue();
        const res = await authed(makeApp([VALID_KEY], 10, queue)).send([VALID_ENTRY, VALID_ENTRY]);
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ queued: 2 });
        expect(queue.size).toBe(2);
    });
});

describe('POST /logs/json — rate limiting', () => {
    it('allows requests up to the limit', async () => {
        const app = makeApp([VALID_KEY], 3);
        for (let i = 0; i < 3; i++) {
            const res = await authed(app).send([VALID_ENTRY]);
            expect(res.status).toBe(202);
        }
    });

    it('returns 429 when the limit is exceeded', async () => {
        const app = makeApp([VALID_KEY], 3);
        for (let i = 0; i < 3; i++) {
            await authed(app).send([VALID_ENTRY]);
        }
        const res = await authed(app).send([VALID_ENTRY]);
        expect(res.status).toBe(429);
        expect(res.headers['retry-after']).toBeDefined();
    });

    it('rate limits per key independently', async () => {
        const app = makeApp([VALID_KEY, 'other-key'], 1);
        await authed(app).send([VALID_ENTRY]);

        const res = await request(app)
            .post('/logs/json')
            .set('Authorization', 'Bearer other-key')
            .send([VALID_ENTRY]);
        expect(res.status).toBe(202);
    });
});
