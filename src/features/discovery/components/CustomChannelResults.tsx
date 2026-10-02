import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Pause, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import type { Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/Modal';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { RepositoryDetailsPanel } from '../../../components/RepositoryDetailsPanel';
import { analysisKey, analyzedRepository, cancelAnalysis, enqueueAnalysis, useCustomAnalysis } from '../custom/analysis';
import { reportCustomError, updateCustomData, useCustomDiscovery } from '../custom/store';
import { issueLabel } from '../custom/taskStatus';
import type { CandidateAssessment, CustomDiscoveryChannel } from '../custom/model';
import { CustomRepositoryBlock } from './CustomRepositoryBlock';

const RepositoryChatSheet = lazy(() => import('../../../components/RepositoryChatSheet'));

export function CustomChannelResults({ channel, items }: { channel: CustomDiscoveryChannel; items: CandidateAssessment[] }) {
  const language = useAppStore(s => s.language);
  const config = useAppStore(s => s.aiConfigs.find(c => c.id === s.activeAIConfig));
  const zh = language.startsWith('zh');
  const l = (cn: string, en: string) => zh ? cn : en;
  const data = useCustomDiscovery(s => s.data);
  const analysis = useCustomAnalysis();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Repository[] | null>(null);
  const repositories = items.map(item => analyzedRepository(item.repo, data, language, config));
  const activeIndex = repositories.findIndex(repo => repo.id === activeId);
  const active = repositories[activeIndex] ?? null;
  const chat = repositories.find(repo => repo.id === chatId);
  const tasks = analysis.items.filter(item => item.channelId === channel.id);
  const running = tasks.some(task => ['queued', 'waiting', 'running'].includes(task.status));
  const failures = tasks.filter(task => task.status === 'failed' && repositories.some(repo => repo.id === task.repo.id));
  const selectedRepos = repositories.filter(repo => selected.has(repo.id));
  const unanalyzed = repositories.filter(repo => !data.analyses?.[analysisKey(repo, language, config)]?.details);
  const request = (repos: Repository[]) => {
    if (repos.some(repo => data.analyses?.[analysisKey(repo, language, config)]?.details)) setConfirm(repos);
    else enqueueAnalysis(channel, repos);
  };
  const handleApprove = async (assessment: CandidateAssessment) => {
    try {
      await updateCustomData(draft => {
        const c = draft.channels.find(x => x.id === channel.id);
        if (c) {
          c.recommended[String(assessment.repo.id)] = new Date().toISOString().slice(0, 10);
          c.blocked = c.blocked.filter(id => id !== assessment.repo.id);
        }
        for (const edition of draft.editions) {
          if (edition.channelId === channel.id) {
            const pendingIndex = edition.pending?.findIndex(p => p.repo.id === assessment.repo.id) ?? -1;
            if (pendingIndex >= 0) {
              const [approved] = edition.pending.splice(pendingIndex, 1);
              if (!edition.entries.some(e => e.repo.id === approved.repo.id)) {
                edition.entries.push({ ...approved, verdict: 'match' });
              }
            }
          }
        }
      });
    } catch (err) {
      reportCustomError(err);
    }
  };
  const handleBlock = async (assessment: CandidateAssessment) => {
    try {
      await updateCustomData(draft => {
        const c = draft.channels.find(x => x.id === channel.id);
        if (c) {
          if (!c.blocked.includes(assessment.repo.id)) {
            c.blocked.push(assessment.repo.id);
          }
        }
        for (const edition of draft.editions) {
          if (edition.channelId === channel.id) {
            if (edition.pending) {
              edition.pending = edition.pending.filter(p => p.repo.id !== assessment.repo.id);
            }
            if (edition.entries) {
              edition.entries = edition.entries.filter(e => e.repo.id !== assessment.repo.id);
            }
          }
        }
      });
    } catch (err) {
      reportCustomError(err);
    }
  };
  return <>
    <div className="flex flex-wrap items-center gap-2 border-b pb-3">
      <label className="mr-1 flex items-center gap-2 text-xs"><input type="checkbox" aria-label={l('选择当前列表', 'Select current list')}
        checked={repositories.length > 0 && selectedRepos.length === repositories.length} disabled={!repositories.length}
        onChange={event => setSelected(event.target.checked ? new Set(repositories.map(repo => repo.id)) : new Set())} />{selectedRepos.length}/{repositories.length}</label>
      <Button variant="outline" size="sm" disabled={!unanalyzed.length || running} onClick={() => enqueueAnalysis(channel, unanalyzed)}>
        <Sparkles className="mr-1.5 h-4 w-4" />{l('分析未分析项', 'Analyze remaining')}
      </Button>
      <Button variant="outline" size="sm" disabled={!selectedRepos.length || running} onClick={() => request(selectedRepos)}>{l('分析所选', 'Analyze selected')} {selectedRepos.length || ''}</Button>
      {!!tasks.length && <span role="status" className="text-xs text-muted-foreground">{l('内容分析', 'Content analysis')} {tasks.filter(task => ['done', 'failed', 'cancelled'].includes(task.status)).length}/{tasks.length}</span>}
      {running && <>
        <Button variant="ghost" size="icon" title={analysis.paused ? l('继续分析', 'Resume analysis') : l('暂停分析', 'Pause analysis')}
          aria-label={analysis.paused ? l('继续分析', 'Resume analysis') : l('暂停分析', 'Pause analysis')}
          onClick={() => useCustomAnalysis.setState({ paused: !analysis.paused })}>{analysis.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button>
        <Button variant="ghost" size="icon" title={l('取消分析', 'Cancel analysis')} aria-label={l('取消分析', 'Cancel analysis')} onClick={() => cancelAnalysis(channel.id)}><Square className="h-4 w-4" /></Button>
      </>}
      {!running && !!failures.length && <Button variant="outline" size="sm" onClick={() => enqueueAnalysis(channel, failures.map(task => task.repo), { force: true })}><RotateCcw className="mr-1 h-4 w-4" />{l('重试失败项', 'Retry failed')} {failures.length}</Button>}
    </div>
    {analysis.issue && <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
      {issueLabel(analysis.issue, zh)}
      {analysis.issue.kind === 'auth' && <Button variant="link" onClick={() => useAppStore.getState().setCurrentView('settings')}>{l('配置 AI', 'Configure AI')}</Button>}
    </div>}
    <div className="relative flex min-w-0 items-start gap-4" data-testid="custom-results-layout">
      <div className="min-w-0 flex-1 space-y-4">
        {items.map((item, index) => <CustomRepositoryBlock key={item.repo.id} item={item} repo={repositories[index]} channel={channel}
          active={activeId === item.repo.id} selected={selected.has(item.repo.id)}
          onSelect={() => setSelected(previous => { const next = new Set(previous); if (next.has(item.repo.id)) next.delete(item.repo.id); else next.add(item.repo.id); return next; })}
          onDetails={() => setActiveId(item.repo.id)} onAsk={() => setChatId(item.repo.id)}
          onAnalyze={() => request([repositories[index]])}
          onApprove={() => void handleApprove(item)}
          onBlock={() => void handleBlock(item)} />)}
      </div>
      <RepositoryDetailsPanel repository={active} onClose={() => setActiveId(null)} defaultDocked onAskRepository={repo => setChatId(repo.id)}
        onPrevious={activeIndex > 0 ? () => setActiveId(repositories[activeIndex - 1].id) : undefined}
        onNext={activeIndex >= 0 && activeIndex < repositories.length - 1 ? () => setActiveId(repositories[activeIndex + 1].id) : undefined}
        analysisAction={repo => <Button variant="outline" size="sm" disabled={tasks.some(task => task.repo.id === repo.id && ['queued', 'waiting', 'running'].includes(task.status))}
          onClick={() => request([repo])}><Sparkles className="mr-2 h-4 w-4" />{l('AI 分析', 'AI analysis')}</Button>} />
    </div>
    {chat && createPortal(<ErrorBoundary><Suspense fallback={<div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-background/80"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <RepositoryChatSheet isOpen repository={chat} onClose={() => setChatId(null)} />
    </Suspense></ErrorBoundary>, document.body)}
    {confirm && <Modal isOpen onClose={() => setConfirm(null)} title={l('重新分析所选项目？', 'Analyze selected projects again?')}>
      <p className="mt-3 text-sm">{l('将重新调用 AI，成功后替换已有分析；失败时保留原内容。', 'This calls AI again. Successful results replace existing analysis; failures preserve it.')}</p>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirm(null)}>{l('取消', 'Cancel')}</Button><Button onClick={() => { enqueueAnalysis(channel, confirm, { force: true }); setConfirm(null); }}>{l('开始分析', 'Start analysis')}</Button></div>
    </Modal>}
  </>;
}
