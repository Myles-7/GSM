import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { bindLocalResearchGrant, getLocalResearchGrant } from './localResearchGrants';
import type { AgyLocalProject } from '../types/agy';

vi.unmock('../store/useAppStore');
vi.mock('./agyClient', () => ({ refreshAgyDeviceState: vi.fn().mockResolvedValue(undefined) }));
const chooseProject = vi.fn();
const revokeProject = vi.fn().mockResolvedValue(undefined);
const project: AgyLocalProject = { id: 'grant', name: 'fixture', identity: 'a'.repeat(64), entries: [], truncated: false };
beforeEach(() => {
  useAppStore.setState({ user: null, githubToken: null });
  vi.clearAllMocks();
  useAppStore.setState({ user: { id: 77, login: 'fixture' } as NonNullable<ReturnType<typeof useAppStore.getState>['user']> });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { agy: { chooseProject, revokeProject } } });
  chooseProject.mockResolvedValue({ ok: true, value: project });
});

describe('local workbench grants', () => {
  it('rejects a same-name different directory while preserving the previous binding', async () => {
    await bindLocalResearchGrant('s', '77');
    chooseProject.mockResolvedValueOnce({ ok: true, value: { ...project, id: 'other', identity: 'b'.repeat(64) } });
    await expect(bindLocalResearchGrant('s', '77', project.identity)).rejects.toThrow('LOCAL_PROJECT_CHANGED');
    expect(getLocalResearchGrant('s', '77')).toEqual(project);
    expect(revokeProject).toHaveBeenCalledWith('other');
    expect(revokeProject).not.toHaveBeenCalledWith('grant');
  });
  it('requires reauthorization after account or token changes', async () => {
    await bindLocalResearchGrant('s', '77');
    useAppStore.setState({ githubToken: 'new-token' });
    expect(getLocalResearchGrant('s', '77')).toBeUndefined();
    expect(revokeProject).toHaveBeenCalledWith('grant');
  });
  it('rejects a pending picker result after A-to-B-to-A account changes', async () => {
    let finish!: (result: unknown) => void;
    chooseProject.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = bindLocalResearchGrant('s', '77');
    await vi.waitFor(() => expect(chooseProject).toHaveBeenCalled());
    const user = useAppStore.getState().user;
    useAppStore.setState({ user: null });
    useAppStore.setState({ user });
    finish({ ok: true, value: project });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(getLocalResearchGrant('s', '77')).toBeUndefined();
    expect(revokeProject).toHaveBeenCalledWith('grant');
  });
});
