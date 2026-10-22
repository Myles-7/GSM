import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';

vi.mock('../../src/services/logger.js', () => ({ logger: { errorFromError: vi.fn() } }));
afterEach(() => vi.unstubAllEnvs());

describe('HTTP error responses', () => {
  it('returns a useful 400 for malformed JSON without reflecting its contents', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = express();
    app.use(express.json());
    app.post('/', (_req, res) => res.sendStatus(204));
    app.use(errorHandler);
    const response = await request(app).post('/').set('Content-Type', 'application/json').send('{"secret":"sensitive",');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid JSON request body', code: 'INVALID_JSON' });
  });

  it('identifies oversized bodies as 413 rather than internal failures', async () => {
    const app = express();
    app.use(express.json({ limit: '10b' }));
    app.post('/', (_req, res) => res.sendStatus(204));
    app.use(errorHandler);
    const response = await request(app).post('/').send({ content: 'too large' });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' });
  });

  it.each([undefined, 0, 200, 700, 400.5, '400'])('treats invalid error status %s as a private server failure', async statusCode => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = express();
    app.get('/', () => { throw Object.assign(new Error('database password must stay private'), { statusCode }); });
    app.use(errorHandler);
    const response = await request(app).get('/');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal Server Error', code: 'INTERNAL_SERVER_ERROR' });
  });
});
