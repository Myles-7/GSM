import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopDavFetch, supportsDesktopDav, type DesktopDavResult } from './electronProxy';

function bridge(result: DesktopDavResult = { success: true, status: 200, body: 'ok' }) {
  const webdavRequest = vi.fn().mockResolvedValue(result);
  const webdavCancel = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI = { webdavRequest, webdavCancel } as unknown as Window['electronAPI'];
  return { webdavRequest, webdavCancel };
}

describe('desktop DAV bridge', () => {
  beforeEach(() => { delete window.electronAPI; });
  afterEach(() => { delete window.electronAPI; vi.useRealTimers(); });

  it('requires both request and cancel capabilities; never falls back to browser fetch', async () => {
    expect(supportsDesktopDav()).toBe(false);
    window.electronAPI = { webdavRequest: vi.fn() } as unknown as Window['electronAPI'];
    expect(supportsDesktopDav()).toBe(false);
    await expect(desktopDavFetch('https://dav.example/')).rejects.toThrow('unavailable');
  });

  it('sends a unique owned request with normalized headers and inline text body', async () => {
    const { webdavRequest } = bridge({ success: true, status: 207, body: '<xml/>', headers: { dav: '1,2' } });
    const result = await desktopDavFetch('https://dav.example/', {
      method: 'PROPFIND', headers: { Authorization: 'Basic unsaved' }, body: '<propfind/>',
    }, 15000);
    const first = webdavRequest.mock.calls[0][0];
    expect(first).toMatchObject({
      url: 'https://dav.example/', method: 'PROPFIND', headers: { authorization: 'Basic unsaved' },
      body: '<propfind/>', timeoutMs: 15000,
    });
    expect(first.requestId).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(result.status).toBe(207);
    expect(result.headers.get('dav')).toBe('1,2');
    expect(await result.text()).toBe('<xml/>');
    await desktopDavFetch('https://dav.example/');
    expect(webdavRequest.mock.calls[1][0].requestId).not.toBe(first.requestId);
  });

  it.each([204, 205, 304])('reconstructs bodyless status %i', async status => {
    bridge({ success: true, status, body: 'ignored' });
    const response = await desktopDavFetch('https://dav.example/');
    expect(response.body).toBeNull();
  });

  it('HEAD ignores a response body even on status 200', async () => {
    bridge();
    expect((await desktopDavFetch('https://dav.example/', { method: 'head' })).body).toBeNull();
  });

  it.each([0, 199, 600, 200.5])('rejects invalid response status %i', async status => {
    bridge({ success: true, status });
    await expect(desktopDavFetch('https://dav.example/')).rejects.toThrow('Invalid DAV response');
  });

  it('pre-abort sends no request and no cancel', async () => {
    const api = bridge();
    const controller = new AbortController();
    controller.abort();
    await expect(desktopDavFetch('https://dav.example/', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.webdavRequest).not.toHaveBeenCalled();
    expect(api.webdavCancel).not.toHaveBeenCalled();
  });

  it('active abort sends precisely one cancellation with the same request ID', async () => {
    const api = bridge();
    api.webdavRequest.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = desktopDavFetch('https://dav.example/', { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(api.webdavCancel).toHaveBeenCalledExactlyOnceWith(api.webdavRequest.mock.calls[0][0].requestId);
  });

  it('an abort during bridge submission is not missed', async () => {
    const api = bridge();
    const controller = new AbortController();
    api.webdavRequest.mockImplementation(() => {
      controller.abort();
      return new Promise(() => {});
    });
    await expect(desktopDavFetch('https://dav.example/', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.webdavCancel).toHaveBeenCalledTimes(1);
  });

  it('renderer deadline cancels a nonresponding main process and cleans up its timer', async () => {
    vi.useFakeTimers();
    const api = bridge();
    api.webdavRequest.mockImplementation(() => new Promise(() => {}));
    const pending = desktopDavFetch('https://dav.example/', {}, 1000);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(api.webdavCancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ timedOut: true }, { canceled: true }])('main cancellation %j is an AbortError', async fields => {
    bridge({ success: false, ...fields });
    await expect(desktopDavFetch('https://dav.example/')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('normal completion removes the listener and does not send a later cancel', async () => {
    vi.useFakeTimers();
    const api = bridge();
    const controller = new AbortController();
    await desktopDavFetch('https://dav.example/', { signal: controller.signal });
    controller.abort();
    expect(api.webdavCancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects unsupported binary upload bodies before submission', async () => {
    const api = bridge();
    await expect(desktopDavFetch('https://dav.example/', { body: new Blob(['bytes']) })).rejects.toThrow('text body');
    expect(api.webdavRequest).not.toHaveBeenCalled();
  });

  it('reports network failures without a browser fallback', async () => {
    bridge({ success: false, error: 'DAV request failed' });
    await expect(desktopDavFetch('https://dav.example/')).rejects.toThrow('DAV request failed');
  });
});
