import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebDAVService } from './webdavService';
import { backend } from './backendAdapter';

vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), isDebugMode: () => false } }));
vi.mock('./backendAdapter', () => ({ backend: { isAvailable: true, proxyWebDAV: vi.fn() } }));
const config = {
  id: 'unsaved', name: 'Unsaved DAV', url: 'https://dav.example', username: 'new-user',
  password: 'new-secret', path: '/backup/nested', isActive: true,
};
function desktop(status = 200, body = '{}') {
  const webdavRequest = vi.fn().mockResolvedValue({ success: true, status, body });
  const webdavCancel = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI = { webdavRequest, webdavCancel } as unknown as Window['electronAPI'];
  return { webdavRequest, webdavCancel };
}

describe('WebDAV desktop-only transport', () => {
  beforeEach(() => { delete window.electronAPI; vi.mocked(window.fetch).mockReset(); vi.mocked(backend.proxyWebDAV).mockReset(); });
  afterEach(() => { delete window.electronAPI; vi.useRealTimers(); });

  it('browser/backend mode still uses the existing direct fetch, never backend proxy', async () => {
    vi.mocked(window.fetch).mockResolvedValue(new Response('{}'));
    expect(await new WebDAVService(config).downloadFile('data.json')).toBe('{}');
    expect(window.fetch).toHaveBeenCalledWith('https://dav.example/backup/nested/data.json', expect.objectContaining({ method: 'GET' }));
    expect(backend.proxyWebDAV).not.toHaveBeenCalled();
  });

  it('desktop download uses inline unsaved credentials, not saved config or browser fetch', async () => {
    const api = desktop();
    await new WebDAVService(config).downloadFile('data.json');
    expect(api.webdavRequest.mock.calls[0][0]).toMatchObject({
      url: 'https://dav.example/backup/nested/data.json', method: 'GET', timeoutMs: 30000,
      headers: { authorization: `Basic ${btoa('new-user:new-secret')}` },
    });
    expect(window.fetch).not.toHaveBeenCalled();
    expect(backend.proxyWebDAV).not.toHaveBeenCalled();
  });

  it('HEAD fallback shares its signal and deadline with PROPFIND', async () => {
    const api = desktop();
    api.webdavRequest.mockResolvedValueOnce({ success: true, status: 405 })
      .mockResolvedValueOnce({ success: true, status: 207, body: '<xml/>' });
    expect(await new WebDAVService(config).testConnection()).toBe(true);
    expect(api.webdavRequest.mock.calls.map(([params]) => [params.method, params.timeoutMs])).toEqual([['HEAD', 10000], ['PROPFIND', 10000]]);
  });

  it('upload creates nested collections then PUTs exactly once with a dynamic deadline', async () => {
    const api = desktop(201);
    await new WebDAVService(config).uploadFile('data.json', 'x'.repeat(2 * 1024 * 1024));
    expect(api.webdavRequest.mock.calls.map(([params]) => params.method)).toEqual(['MKCOL', 'MKCOL', 'PUT']);
    expect(api.webdavRequest.mock.calls[2][0].timeoutMs).toBe(204800);
  });

  it('failed desktop PUT is not automatically replayed', async () => {
    const api = desktop(201);
    api.webdavRequest.mockImplementation(params => Promise.resolve(params.method === 'PUT'
      ? { success: false, timedOut: true } : { success: true, status: 201 }));
    await expect(new WebDAVService(config).uploadFile('data.json', '{}')).rejects.toThrow();
    expect(api.webdavRequest.mock.calls.filter(([params]) => params.method === 'PUT')).toHaveLength(1);
  });

  it('PROPFIND preserves DAV namespaces, escaped filenames and ignores non-JSON resources', async () => {
    desktop(207, '<z:multistatus xmlns:z="DAV:"><z:response><z:href>/backup/a%20b.json</z:href></z:response><z:response><z:href>/backup/image.png</z:href></z:response></z:multistatus>');
    expect(await new WebDAVService(config).listFiles()).toEqual(['a b.json']);
  });

  it('404 download is null and OPTIONS preserves server and DAV metadata', async () => {
    const api = desktop(404);
    expect(await new WebDAVService(config).downloadFile('missing.json')).toBeNull();
    api.webdavRequest.mockResolvedValue({ success: true, status: 200, headers: { server: 'isolated', dav: '1,2' } });
    expect(await new WebDAVService(config).getServerInfo()).toEqual({ server: 'isolated', davLevel: '1,2' });
  });

  it.each(['download', 'list', 'exists', 'info', 'test', 'upload'])('caller cancellation of %s propagates and cancels IPC', async operation => {
    vi.useFakeTimers();
    const api = desktop();
    api.webdavRequest.mockImplementation(() => new Promise(() => {}));
    const service = new WebDAVService(config);
    const controller = new AbortController();
    const signal = controller.signal;
    const pending = operation === 'download' ? service.downloadFile('data.json', signal)
      : operation === 'list' ? service.listFiles(signal)
        : operation === 'exists' ? service.fileExists('data.json', signal)
          : operation === 'info' ? service.getServerInfo(signal)
            : operation === 'test' ? service.testConnection(signal) : service.uploadFile('data.json', '{}', signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(api.webdavCancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancellation during collection creation never continues to PUT', async () => {
    const api = desktop();
    api.webdavRequest.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = new WebDAVService(config).uploadFile('data.json', '{}', controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(api.webdavRequest.mock.calls.map(([params]) => params.method)).toEqual(['MKCOL']);
  });
});
