import express from 'express';
import request from 'supertest';
import http from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const proxy = vi.hoisted(() => vi.fn());
vi.mock('../../src/db/connection.js', () => ({ getDb: () => ({ prepare: () => ({ get: () => undefined }) }) }));
vi.mock('../../src/services/proxyService.js', async importOriginal => ({ ...await importOriginal<object>(), proxyRequest: proxy }));
const { default: router } = await import('../../src/routes/proxy.js');
const app = express(); app.use(express.json()); app.use(router);
const input = { config: { apiType: 'openai', baseUrl: 'https://example.com', apiKey: 'fixture-key', model: 'fixture' }, body: { stream: true, messages: [] } };
beforeEach(() => { proxy.mockReset(); });
describe('AI stream proxy', () => {
  it('relays incremental bytes and disables redirects with a shared deadline and abort signal', async () => {
    proxy.mockResolvedValue({ status: 200, headers: { 'content-type': 'text/event-stream' }, data: Readable.from(['data: hello\n\n', 'data: [DONE]\n\n']) });
    const response = await request(app).post('/api/proxy/ai').send(input).expect(200);
    expect(response.text).toBe('data: hello\n\ndata: [DONE]\n\n');
    expect(response.headers['x-accel-buffering']).toBe('no');
    expect(proxy.mock.calls[0][0]).toMatchObject({ stream: true, maxRedirects: 0, timeout: 600000, signal: expect.any(AbortSignal) });
  });
  it('uses the Gemini streaming endpoint without adding unsupported fields to its body', async () => {
    proxy.mockResolvedValue({ status: 200, headers: {}, data: {} });
    await request(app).post('/api/proxy/ai').send({ ...input, stream: true, config: { ...input.config, apiType: 'gemini' }, body: { contents: [] } }).expect(200);
    expect(proxy.mock.calls[0][0].url).toContain(':streamGenerateContent');
    expect(proxy.mock.calls[0][0].url).toContain('alt=sse');
    expect(proxy.mock.calls[0][0].body).toEqual({ contents: [] });
  });
  it('rejects public plain HTTP before forwarding credentials', async () => {
    await request(app).post('/api/proxy/ai').send({ ...input, config: { ...input.config, baseUrl: 'http://example.com' } }).expect(400);
    expect(proxy).not.toHaveBeenCalled();
  });
  it('aborts upstream and destroys its stream when the client disconnects', async () => {
    const upstream = new PassThrough();
    let aborted!: () => void;
    const canceled = new Promise<void>(resolve => { aborted = resolve; });
    proxy.mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener('abort', aborted, { once: true });
      setImmediate(() => upstream.write('data: first\n\n'));
      return { status: 200, headers: { 'content-type': 'text/event-stream' }, data: upstream };
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const client = http.request({ host: '127.0.0.1', port: address.port, path: '/api/proxy/ai', method: 'POST', headers: { 'Content-Type': 'application/json' } });
      client.on('error', () => {});
      client.on('response', response => response.once('data', () => response.destroy()));
      client.end(JSON.stringify(input));
      await Promise.race([canceled, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Upstream was not canceled')), 1500); })]);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(upstream.destroyed).toBe(true);
    } finally { clearTimeout(timer); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
