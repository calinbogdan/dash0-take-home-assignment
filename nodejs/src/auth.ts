import { Request, Response, NextFunction } from 'express';

export interface ApiKeyStore {
    validate(key: string): Promise<boolean>;
}

export class InMemoryApiKeyStore implements ApiKeyStore {
    private keys: Set<string>;

    constructor(keys: string[]) {
        this.keys = new Set(keys);
    }

    async validate(key: string): Promise<boolean> {
        return this.keys.has(key);
    }
}

export function authenticate(store: ApiKeyStore) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Missing or malformed Authorization header' });
            return;
        }

        const key = header.slice(7);
        const valid = await store.validate(key);
        if (!valid) {
            res.status(401).json({ error: 'Invalid API key' });
            return;
        }

        next();
    };
}
