import type { AgyLocalProject } from '../types/agy';
import { useAppStore } from '../store/useAppStore';
import { refreshAgyDeviceState } from './agyClient';

const grants = new Map<string, { owner: string; project: AgyLocalProject }>();
let generation = 0;
useAppStore.subscribe((next, previous) => {
  if (next.user?.id === previous.user?.id && next.githubToken === previous.githubToken) return;
  generation++;
  for (const grant of grants.values()) void window.electronAPI?.agy?.revokeProject(grant.project.id).catch(() => {});
  grants.clear();
});

export function getLocalResearchGrant(sessionId: string, owner: string) {
  const grant = grants.get(sessionId);
  return grant?.owner === owner ? grant.project : undefined;
}

export async function bindLocalResearchGrant(sessionId: string, owner: string, expectedIdentity?: string) {
  const api = window.electronAPI?.agy;
  if (!api) throw new Error('AGY_DESKTOP_REQUIRED');
  const startedGeneration = generation;
  await refreshAgyDeviceState();
  const result = await api.chooseProject(crypto.randomUUID());
  if (!result.ok) throw new Error(`AGY_${result.code}`);
  if (generation !== startedGeneration || String(useAppStore.getState().user?.id ?? '') !== owner) {
    await api.revokeProject(result.value.id);
    throw new DOMException('Account changed', 'AbortError');
  }
  if (expectedIdentity && result.value.identity !== expectedIdentity) {
    await api.revokeProject(result.value.id);
    throw new Error('LOCAL_PROJECT_CHANGED');
  }
  const old = grants.get(sessionId);
  if (old) await api.revokeProject(old.project.id);
  grants.set(sessionId, { owner, project: result.value });
  return result.value;
}
