export const config = {
    port: parseInt(process.env.PORT ?? '3003', 10),
    apiKeys: (process.env.API_KEYS ?? '').split(',').map(k => k.trim()).filter(Boolean),
    rateLimitPerSecond: parseInt(process.env.RATE_LIMIT_PER_SECOND ?? '10', 10),
};