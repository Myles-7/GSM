import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_POLICY, UpdateService } from './updateService';
import { logger } from './logger';

vi.mock('./logger', () => ({ logger: { error: vi.fn() } }));

const versionXML = (number: string) => `<version>
  <number>${number}</number><releaseDate>2026-09-25</releaseDate>
  <changelog><item>Upstream notes</item></changelog>
  <downloadUrl>https://github.com/AmintaCCCP/GithubStarsManager/releases/tag/v${number}</downloadUrl>
</version>`;

const fetchMock = vi.fn<typeof fetch>();
const respondWith = (xml: string) => fetchMock.mockResolvedValue({
  ok: true,
  text: async () => xml,
} as Response);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('manual upstream update service', () => {
  it('reports the highest upstream version as non-installable without changing the personal version', async () => {
    respondWith(`<versions>${versionXML('0.8.5')}${versionXML('0.8.3')}</versions>`);

    const result = await UpdateService.checkUpstreamUpdates();

    expect(UPDATE_POLICY.automaticChecks).toBe(false);
    expect(UPDATE_POLICY.notifications).toBe(false);
    expect(result).toMatchObject({
      source: 'upstream', installable: false, currentVersion: '0.8.4', hasUpdate: true,
      latestVersion: { number: '0.8.5', changelog: ['Upstream notes'] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/AmintaCCCP/GithubStarsManager/main/versions/version-info.xml',
      { signal: expect.any(AbortSignal) },
    );
  });

  it.each(['0.8.3', '0.8.4'])('retains upstream details for %s without declaring the personal build latest', async (number) => {
    respondWith(`<versions>${versionXML(number)}</versions>`);
    expect(await UpdateService.checkUpstreamUpdates()).toMatchObject({
      source: 'upstream', installable: false, currentVersion: '0.8.4', hasUpdate: false,
      latestVersion: { number },
    });
  });

  it.each([
    ['malformed XML', '<versions><version></versions>'],
    ['empty XML', '<versions />'],
    ['incomplete entries', '<versions><version><number>0.8.5</number></version></versions>'],
  ])('rejects %s instead of reporting no update', async (_name, xml) => {
    respondWith(xml);
    await expect(UpdateService.checkUpstreamUpdates()).rejects.toThrow();
  });

  it('rejects HTTP errors', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(UpdateService.checkUpstreamUpdates()).rejects.toThrow('HTTP error! status: 503');
  });

  it.each(['fetch', 'response body'])('bounds a stalled %s even when the transport ignores cancellation', async (stage) => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url, options) => {
      requestSignal = options?.signal ?? undefined;
      if (stage === 'fetch') return new Promise<Response>(() => undefined);
      return Promise.resolve({ ok: true, text: () => new Promise<string>(() => undefined) } as Response);
    });
    const pending = UpdateService.checkUpstreamUpdates();
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(UPDATE_POLICY.requestTimeoutMs);
    await rejected;

    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels in-flight work and removes its deadline without logging an error', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const pending = UpdateService.checkUpstreamUpdates(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    const requestSignal = fetchMock.mock.calls[0][1]?.signal;

    controller.abort();
    await rejected;

    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not fetch when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(UpdateService.checkUpstreamUpdates(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
