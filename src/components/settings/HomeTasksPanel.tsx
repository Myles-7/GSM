import { useCallback, useEffect, useRef, useState } from 'react';
import type { HomeSync } from '../../home/sync';
import type { HomeRecord, HomeTask } from '../../home/types';

const button = 'rounded border px-3 py-2 text-sm disabled:opacity-50';
const statuses: Record<string, string> = { queued: '排队中', running: '执行中', completed: '已完成', interrupted: '已中断', cancelled: '已取消', failed: '失败' };
type ProposalOperation = { kind: string; repository: string; patch?: unknown };

function ProposalReview({ record, repositories, sync, refresh }: { record: HomeRecord; repositories: HomeRecord[]; sync: HomeSync; refresh: () => Promise<void> }) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const applying = useRef(false);
  const proposal = (record.data?.proposal ?? record.data?.data ?? record.data) as { title?: string; rationale?: string; operations?: ProposalOperation[] } | null;
  const operations = Array.isArray(proposal?.operations) ? proposal.operations : [];
  const applied = Array.isArray(record.data?.appliedIndices) ? record.data.appliedIndices : [];
  const versions = JSON.stringify(Object.fromEntries(repositories.map(row => [row.id, row.version])));
  useEffect(() => { setChosen([]); setConfirmed(false); }, [record.version, versions]);
  const apply = async () => {
    if (applying.current || !confirmed || !chosen.length) return;
    applying.current = true; setBusy(true); setConfirmed(false);
    try {
      const response = await sync.api.request(`/proposals/${encodeURIComponent(record.id)}/apply`, {
        ...sync.identity, proposalVersion: record.version, confirm: true, selectedIndices: chosen,
        expectedVersions: JSON.parse(versions),
      });
      setResult(JSON.stringify(response, null, 2)); setChosen([]);
    } catch (error) { setResult(error instanceof Error ? error.message : '提案执行失败'); }
    finally {
      try { await refresh(); } catch (error) { setResult(previous => `${previous}\n刷新失败：${error instanceof Error ? error.message : '请重新同步'}`); }
      applying.current = false; setBusy(false);
    }
  };
  return <article className="space-y-3 rounded border p-3" aria-label={`提案 ${record.id}`}>
    <h5 className="font-medium">{proposal?.title || '操作提案'} · 版本 {record.version} · {String(record.data?.status || 'pending')}</h5>
    {proposal?.rationale && <p className="text-sm text-muted-foreground">{proposal.rationale}</p>}
    {operations.map((operation, index) => <label key={index} className="flex items-start gap-2 text-sm">
      <input type="checkbox" disabled={busy || applied.includes(index) || record.data?.status === 'applied'} checked={chosen.includes(index)} onChange={event => { const checked = event.target.checked; setChosen(current => checked ? [...current, index] : current.filter(item => item !== index)); setConfirmed(false); }} />
      <span>{operation.kind} · {operation.repository}{applied.includes(index) ? '（已执行）' : ''}{operation.patch !== undefined && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(operation.patch, null, 2)}</pre>}</span>
    </label>)}
    <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy || !chosen.length} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认执行以上选中操作，包括相应的 GitHub 修改</label>
    <button className={button} disabled={busy || !confirmed || !chosen.length} onClick={() => void apply()}>{busy ? '正在执行…' : '执行选中操作'}</button>
    {result && <pre role="status" className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{result}</pre>}
  </article>;
}

export function HomeTasksPanel({ sync }: { sync: HomeSync }) {
  const [tasks, setTasks] = useState<HomeTask[]>([]);
  const [proposals, setProposals] = useState<HomeRecord[]>([]);
  const [repositories, setRepositories] = useState<HomeRecord[]>([]);
  const [error, setError] = useState('');
  const query = new URLSearchParams({ workspaceId: sync.identity.workspaceId, githubUserId: String(sync.identity.githubUserId) }).toString();
  const load = useCallback(async () => {
    const [response, proposals, repositories] = await Promise.all([
      sync.api.request<{ tasks: HomeTask[] }>(`/tasks?${query}`), sync.db.list('proposals'), sync.db.list('repositories'),
    ]);
    setTasks(response.tasks); setProposals(proposals.filter(row => !row.deleted)); setRepositories(repositories.filter(row => !row.deleted)); setError('');
  }, [sync, query]);
  const refresh = useCallback(async () => { await sync.sync(); await load(); }, [sync, load]);
  useEffect(() => {
    const update = () => { void load().catch(error => setError(error instanceof Error ? error.message : '任务加载失败')); };
    update(); const unsubscribe = sync.subscribe(update); const timer = setInterval(update, 15000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [sync, load]);
  return <section className="space-y-3 border-t border-border pt-4" aria-label="家庭后端任务与提案">
    <div className="flex items-center justify-between"><h4 className="font-semibold">家庭后端任务与提案</h4><button className={button} onClick={() => void refresh().catch(error => setError(error.message))}>刷新任务与提案</button></div>
    {error && <p role="alert" className="text-sm">{error}</p>}
    {!tasks.length && <p className="text-sm text-muted-foreground">暂无后端任务</p>}
    {tasks.map(task => <details key={task.id} className="rounded border p-3"><summary className="cursor-pointer text-sm">{task.kind} · {statuses[task.status] || task.status} · {String(task.input.prompt || (task.input.repositories as string[] | undefined)?.join(', ') || task.id)}</summary><p className="mt-2 text-xs text-muted-foreground">{new Date(task.updatedAt).toLocaleString()}{task.stage ? ` · ${task.stage}` : ''}</p>{task.error && <p className="text-sm">{task.error}</p>}<pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{String(task.result?.content || '等待后端返回结果…')}</pre></details>)}
    <h4 className="font-semibold">待审核及已执行提案</h4>
    {!proposals.length && <p className="text-sm text-muted-foreground">暂无同步提案</p>}
    {proposals.map(record => <ProposalReview key={record.id} record={record} repositories={repositories} sync={sync} refresh={refresh} />)}
  </section>;
}
