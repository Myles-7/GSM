import { expect, it, vi } from 'vitest';
import { allowReadingNavigation, blockReadingNavigation, registerReadingLeaveGuard, requestReadingConfiguration } from './readingNavigation';

it('guards only departure from reading and allows a confirmed navigation once', () => {
  const callback = vi.fn(); const dispose = registerReadingLeaveGuard(callback);
  expect(blockReadingNavigation('reading', 'repositories')).toBe(true);
  expect(callback).toHaveBeenCalledWith('repositories');
  expect(blockReadingNavigation('reading', 'reading')).toBe(false);
  expect(blockReadingNavigation('ai', 'repositories')).toBe(false);
  allowReadingNavigation(() => expect(blockReadingNavigation('reading', 'settings')).toBe(false));
  expect(blockReadingNavigation('reading', 'settings')).toBe(true);
  dispose(); expect(blockReadingNavigation('reading', 'settings')).toBe(false);
});
it('does not let a stale guard dispose a newer account guard', () => {
  const old = registerReadingLeaveGuard(vi.fn()); const next = vi.fn(); const dispose = registerReadingLeaveGuard(next);
  old(); expect(blockReadingNavigation('reading', 'settings')).toBe(true); expect(next).toHaveBeenCalledOnce(); dispose();
});
it('bridges legacy settings navigation using a one-time target and a same-window event', () => {
  const listener = vi.fn(); window.addEventListener('gsm:reading-configuration', listener);
  requestReadingConfiguration(); expect(sessionStorage.getItem('gsm:pending-reading-page')).toBe('settings'); expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener('gsm:reading-configuration', listener); sessionStorage.clear();
});
