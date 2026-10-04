// Disposable, synthetic UI states. Imported only by scripts/audit-ui.mjs.
import { useAppStore } from '../../src/store/useAppStore';
import { repositoryChatStorage } from '../../src/services/repositoryChatStorage';
import type { WorkbenchCandidate } from '../../src/types/aiWorkbench';

export async function configureAIUX(mode: string) {
  const state = useAppStore.getState();
  if (state.user?.id !== 990001) throw new Error('AI UX fixture requires the anonymous audit account');
  const count = mode === 'limit' ? 126 : 24;
  const names = ['离线检索与资料整理', '开发流程与部署', '研究素材与知识库'];
  const candidates: WorkbenchCandidate[] = Array.from({ length: count }, (_, i) => {
    const r = state.repositories[i % state.repositories.length];
    const repository = { ...r, id: 200000 + i, name: `project-${i + 1}`, full_name: `fixture/project-${i + 1}`, html_url: `https://github.com/fixture/project-${i + 1}` };
    return { repository, summary: '匿名离线示例', reasons: [], limitations: [], sources: [], status: 'candidate', overview: {
      summary: '面向个人资料管理的开源工具，支持本地检索、结构化整理与导出。适合希望在自己的设备上保存研究成果的用户。',
      category: names[Math.floor(i / 8) % 3], categoryDescription: '按使用目标分组，便于选择下一步研究范围。',
      kind: i % 3 === 0 ? 'library' : 'tool', status: i === 2 ? 'insufficient' : i === 5 ? 'failed' : 'ready',
      basis: i === 2 ? 'metadata' : 'readme', ...(i === 5 ? { error: 'Fixture: material retrieval failed' } : {}),
    } };
  });
  const stamp = '2026-10-04T00:00:00.000Z';
  const id = `ai-ux-${mode}`;
  await repositoryChatStorage.saveSession({ id, ownerId: '990001', kind: 'workbench', repoId: 0, repoFullName: 'AI Workbench', sourceRefSha: '',
    title: 'AI 使用体验 · 离线验收', createdAt: stamp, updatedAt: stamp,
    workbench: { scope: 'github', depth: 'standard', inputIntent: 'results', selectedRepositories: [], searchBatches: [{
      id: 'fixture-batch', createdAt: stamp, requirements: { purpose: '寻找适合个人使用的开源资料管理工具', required: ['本地可用'], preferred: ['清晰文档'], excluded: [], questions: [], queries: [] },
      candidates: mode === 'empty' ? [] : candidates, queries: [], nextPage: 1,
      overviewSummary: '以下为匿名离线示例。总览用于快速筛选候选；材料不足的项目需要进一步取证，不能据此推断功能已得到验证。',
    }] } });
  sessionStorage.setItem('gsm:ai-workbench-session', id);
  // An incomplete configuration deliberately exercises the readiness guide.
  useAppStore.setState({ aiConfigs: [{ id: 'fixture-unavailable', name: '尚未完成的示例配置', baseUrl: '', apiKey: '', model: 'fixture', isActive: false }], activeAIConfig: 'fixture-unavailable', currentView: 'ai' });
}
