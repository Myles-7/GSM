import { describe, expect, it, vi } from 'vitest';
import type { HomeApi } from './api';
import { migrateDesktopXCredentials } from './desktopXCredentials';
const identity = { workspaceId: 'workspace', githubUserId: 42 };
describe('desktop encrypted X credential migration', () => {
  it('does not read desktop credentials if backend already has a login', async () => {
    const request = vi.fn().mockResolvedValue({ configured: true }); const read = vi.fn();
    expect(await migrateDesktopXCredentials({ request } as unknown as HomeApi, identity, read)).toBe(false);
    expect(read).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not write without an encrypted desktop login', async () => {
    const request = vi.fn().mockResolvedValue({ configured: false });
    expect(await migrateDesktopXCredentials({ request } as unknown as HomeApi, identity, async () => null)).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('uses only the dedicated backend vault endpoint for a missing login', async () => {
    const request = vi.fn().mockResolvedValueOnce({ configured: false }).mockResolvedValueOnce({ configured: true });
    const read = vi.fn(async () => ({ authToken: 'test-only-token', ct0: 'test-only-csrf' }));
    expect(await migrateDesktopXCredentials({ request } as unknown as HomeApi, identity, read)).toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, '/discovery/x/credentials?workspaceId=workspace&githubUserId=42');
    expect(request).toHaveBeenNthCalledWith(2, '/discovery/x/credentials', { ...identity, authToken: 'test-only-token', ct0: 'test-only-csrf' });
  });
});
