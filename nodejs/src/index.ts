import 'dotenv/config';
import './tracing';
import { createApp } from './app';
import { config } from './config';
import { InMemoryApiKeyStore } from './auth';
import { SlidingWindowRateLimiter } from './rateLimiter';
import { LogQueue } from './queue';
import { startWorker, createLogProcessor } from './worker';

const apiKeyStore = new InMemoryApiKeyStore(config.apiKeys);
const limiter = new SlidingWindowRateLimiter(config.rateLimitPerSecond);
const queue = new LogQueue();
const app = createApp(apiKeyStore, limiter, queue);

startWorker(queue, config.workerConcurrency, createLogProcessor(config.processingDelayMs, config.failureRate));

app.listen(config.port, () => {
    console.log(JSON.stringify({ level: 'info', message: `Server started`, port: config.port }));
});
