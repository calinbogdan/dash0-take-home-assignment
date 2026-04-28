import { createApp } from './app';
import { config } from './config';
import { InMemoryApiKeyStore } from './auth';
import { SlidingWindowRateLimiter } from './rateLimiter';

const apiKeyStore = new InMemoryApiKeyStore(config.apiKeys);
const limiter = new SlidingWindowRateLimiter(config.rateLimitPerSecond);
const app = createApp(apiKeyStore, limiter);

app.listen(config.port, () => {
    console.log(JSON.stringify({ level: 'info', message: `Server started`, port: config.port }));
});
