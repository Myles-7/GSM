import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

vi.mock('./logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), errorFromError: vi.fn() } }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

async function install() {
  const add = vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
  const { installGlobalErrorHandlers } = await import('./globalErrorHandlers');
  installGlobalErrorHandlers();
  const callback = add.mock.calls.find(([type]) => type === 'error')![1] as EventListener;
  return { add, callback, installGlobalErrorHandlers };
}

describe('global diagnostics', () => {
  it('installs script/resource and promise handlers exactly once', async () => {
    const { add, installGlobalErrorHandlers } = await install();
    installGlobalErrorHandlers();
    expect(add.mock.calls.map(([type]) => type)).toEqual(['error', 'unhandledrejection']);
    add.mockRestore();
  });

  it('keeps recoverable remote image failures out of error-level output', async () => {
    const { add, callback } = await install();
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: document.createElement('img') });
    callback(event);
    expect(logger.debug).toHaveBeenCalledWith('ui.global', 'Image failed to load', expect.objectContaining({ tag: 'img' }));
    expect(logger.error).not.toHaveBeenCalled();
    add.mockRestore();
  });

  it('reports missing application scripts at error level', async () => {
    const { add, callback } = await install();
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: document.createElement('script') });
    callback(event);
    expect(logger.error).toHaveBeenCalledWith('ui.global', 'Resource failed to load: script', expect.objectContaining({ tag: 'script' }));
    add.mockRestore();
  });
});
