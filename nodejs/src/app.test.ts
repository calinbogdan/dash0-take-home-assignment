import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { InMemoryApiKeyStore } from './auth';
import { SlidingWindowRateLimiter } from './rateLimiter';

const VALID_KEY = 'test-key-123';

function makeApp(keys: string[] = [VALID_KEY], maxPerSecond = 10) {
    const limiter = new SlidingWindowRateLimiter(maxPerSecond);
    return createApp(new InMemoryApiKeyStore(keys), limiter);
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
        const res = await request(makeApp()).post('/logs/json').send([]);
        expect(res.status).toBe(401);
    });

    it('returns 401 when the header is not a Bearer token', async () => {
        const res = await request(makeApp())
            .post('/logs/json')
            .set('Authorization', 'Basic sometoken')
            .send([]);
        expect(res.status).toBe(401);
    });

    it('returns 401 when the API key is invalid', async () => {
        const res = await request(makeApp())
            .post('/logs/json')
            .set('Authorization', 'Bearer wrong-key')
            .send([]);
        expect(res.status).toBe(401);
    });

    it('returns 202 when the API key is valid', async () => {
        const res = await request(makeApp())
            .post('/logs/json')
            .set('Authorization', `Bearer ${VALID_KEY}`)
            .send([]);
        expect(res.status).toBe(202);
    });

    it('returns 401 when the store has no keys configured', async () => {
        const res = await request(makeApp([]))
            .post('/logs/json')
            .set('Authorization', `Bearer ${VALID_KEY}`)
            .send([]);
        expect(res.status).toBe(401);
    });
});

describe('POST /logs/json — rate limiting', () => {
    it('allows requests up to the limit', async () => {
        const app = makeApp([VALID_KEY], 3);
        for (let i = 0; i < 3; i++) {
            const res = await request(app)
                .post('/logs/json')
                .set('Authorization', `Bearer ${VALID_KEY}`)
                .send([]);
            expect(res.status).toBe(202);
        }
    });

    it('returns 429 when the limit is exceeded', async () => {
        const app = makeApp([VALID_KEY], 3);
        for (let i = 0; i < 3; i++) {
            await request(app)
                .post('/logs/json')
                .set('Authorization', `Bearer ${VALID_KEY}`)
                .send([]);
        }
        const res = await request(app)
            .post('/logs/json')
            .set('Authorization', `Bearer ${VALID_KEY}`)
            .send([]);
        expect(res.status).toBe(429);
        expect(res.headers['retry-after']).toBeDefined();
    });

    it('rate limits per key independently', async () => {
        const app = makeApp([VALID_KEY, 'other-key'], 1);
        await request(app)
            .post('/logs/json')
            .set('Authorization', `Bearer ${VALID_KEY}`)
            .send([]);

        const res = await request(app)
            .post('/logs/json')
            .set('Authorization', 'Bearer other-key')
            .send([]);
        expect(res.status).toBe(202);
    });
});
