export const config = {
    port: parseInt(process.env.PORT ?? '3003', 10),
    apiKeys: (process.env.API_KEYS ?? '').split(',').map(k => k.trim()).filter(Boolean),
    rateLimitPerSecond: parseInt(process.env.RATE_LIMIT_PER_SECOND ?? '10', 10),
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10),
    processingDelayMs: parseInt(process.env.PROCESSING_DELAY_MS ?? '100', 10),
    failureRate: parseFloat(process.env.FAILURE_RATE ?? '0'),
};