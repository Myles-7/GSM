import type { AgyLocalProject } from '../types/agy';
import type { AIConfig, Repository } from '../types';
import type { AppLanguage } from '../i18n/languages';
import { runRepositoryChatTurn } from './repositoryChatRunner';
import { forAgyFeature } from './agyProfiles';
import type { RepositoryChatTurnInput, RepositoryChatTurnResult } from './repositoryChatService';

export async function researchLocalProject(project: AgyLocalProject, question: string, config: AIConfig,
  language: AppLanguage, signal: AbortSignal,
  options: Partial<Pick<RepositoryChatTurnInput, 'messages' | 'session' | 'streaming' | 'onAnswerEvent' | 'onToolEvent' | 'taskDepth' | 'deadlineAt' | 'evidenceOnly'>> & {
    previousEvidence?: import('../types/repositoryChat').ToolEvidence[];
  } = {},
): Promise<RepositoryChatTurnResult> {
  const api = window.electronAPI?.agy;
  if (!api) throw new Error('AGY_DESKTOP_REQUIRED');
  const prefs = (await api.getState()).prefs;
  const now = new Date().toISOString();
  const { previousEvidence = [], ...turnOptions } = options;
  let changed = false;
  const repository: Repository = {
    id: -1, name: project.name, full_name: `local/${project.name}`, description: '',
    html_url: '', stargazers_count: 0, forks_count: 0, forks: 0, language: null, topics: [],
    owner: { login: 'local', avatar_url: '' }, created_at: now, updated_at: now, pushed_at: now,
  };
  const result = await runRepositoryChatTurn({
    repository, question, aiConfig: forAgyFeature(config, 'workbench'), language, githubToken: '', signal,
    messages: [], session: { id: crypto.randomUUID(), repoId: -1, repoFullName: repository.full_name,
      sourceRefSha: 'local-snapshot', title: project.name, createdAt: now, updatedAt: now },
    maxToolsPerTurn: 20, taskDepth: 'default',
    agentBudget: { maxDurationMs: Math.max(90_000, Math.min(300_000, prefs.timeoutSeconds * 1_000)) },
    localSource: { entries: project.entries, truncated: project.truncated,
      read: async (relative, readSignal) => {
        if (readSignal.aborted) throw readSignal.reason;
        const id = crypto.randomUUID();
        const cancel = () => { void api.cancel(id); };
        readSignal.addEventListener('abort', cancel, { once: true });
        try {
          const result = await api.readProject(id, project.id, relative);
          if (readSignal.aborted) throw readSignal.reason;
          if (!result.ok) throw new Error(`AGY_${result.code}`);
          if (previousEvidence.some(item => item.source === 'local' && item.path === relative
            && item.contentHash && item.contentHash !== result.value.contentHash)) changed = true;
          return result.value;
        } finally { readSignal.removeEventListener('abort', cancel); }
      },
    },
    ...turnOptions,
  });
  result.researchSources = [{ repository: repository.full_name, status: changed ? 'changed' : 'complete',
    evidenceIds: result.evidences.map(item => item.id), version: project.identity }];
  return result;
}
