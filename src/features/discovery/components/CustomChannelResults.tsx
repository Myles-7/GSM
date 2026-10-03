import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Pause, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import type { Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/Modal';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { RepositoryDetailsPanel } from '../../../components/RepositoryDetailsPanel';
import { analyzedRepository, cancelAnalysis, enqueueAnalysis, setAnalysisPaused, useCustomAnalysis } from '../custom/analysis';
import { reportCustomError, useCustomDiscovery } from '../custom/store';
import { issueLabel } from '../custom/taskStatus';
import { editionKey, type CandidateAssessment, type CustomDiscoveryChannel } from '../custom/model';
import { approveCandidate, blockCandidate } from '../custom/candidateActions';
import { CustomRepositoryBlock } from './CustomRepositoryBlock';
import { useRepositoryAnalysisAssets } from '../../../services/repositoryAnalysisAssets';

const RepositoryChatSheet = lazy(() => import('../../../components/RepositoryChatSheet'));

export function CustomChannelResults({ channel, items, sourceEditionKey }: { channel: CustomDiscoveryChannel; items: CandidateAssessment[]; sourceEditionKey?: string }) {
  const language = useAppStore(s => s.language);
  const config = useAppStore(s => s.aiConfigs.find(c => c.id === s.activeAIConfig));
  const zh = language.startsWith('zh');
  const l = (cn: string, en: string) => zh ? cn : en;
  const data = useCustomDiscovery(s => s.data);
  const sourcePending = new Set(data.editions.find(edition => editionKey(edition) === sourceEditionKey)?.pending.map(item => item.repo.id));
  const analysis = useCustomAnalysis();
  useRepositoryAnalysisAssets(s => s.assets);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [lastBlocked, setLastBlocked] = useState<number | null>(null);
  const paused = !!analysis.pausedChannels[channel.id];
  const issue = analysis.issuesByChannel[channel.id];
  const [confirm, setConfirm] = useState<Repository[] | null>(null);
  const repositories = items.map(item => analyzedRepository(item.repo, data, language, config));
  const activeIndex = repositories.findIndex(repo => repo.id === activeId);
  const active = repositories[activeIndex] ?? null;
  const chat = repositories.find(repo => repo.id === chatId);
  const tasks = analysis.items.filter(item => item.channelId === channel.id);
  const running = tasks.some(task => ['queued', 'waiting', 'running'].includes(task.status));
  const failures = tasks.filter(task => task.status === 'failed' && repositories.some(repo => repo.id === task.repo.id));
  const selectedRepos = repositories.filter(repo => selected.has(repo.id));
  const unanalyzed = repositories.filter(repo => !repo.ai_details);
  const request = (repos: Repository[]) => {
    if (repos.some(repo => !!repo.ai_details)) setConfirm(repos);
    else enqueueAnalysis(channel, repos);
  };
  const handleApprove = async (assessment: CandidateAssessment) => {
    if (!sourceEditionKey) return;
    try { await approveCandidate({ channelId: channel.id, editionKey: sourceEditionKey, repoId: assessment.repo.id }); }
    catch (error) { reportCustomError(error); }
  };
  const handleBlock = async (assessment: CandidateAssessment) => {
    try { await blockCandidate({ channelId: channel.id, repoId: assessment.repo.id }); setLastBlocked(assessment.repo.id); }
    catch (error) { reportCustomError(error); }
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
        <Button variant="ghost" size="icon" title={paused ? l('继续分析', 'Resume analysis') : l('暂停分析', 'Pause analysis')}
          aria-label={paused ? l('继续分析', 'Resume analysis') : l('暂停分析', 'Pause analysis')}
          onClick={() => setAnalysisPaused(channel.id, !paused)}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button>
        <Button variant="ghost" size="icon" title={l('取消分析', 'Cancel analysis')} aria-label={l('取消分析', 'Cancel analysis')} onClick={() => cancelAnalysis(channel.id)}><Square className="h-4 w-4" /></Button>
      </>}
      {!running && !!failures.length && <Button variant="outline" size="sm" onClick={() => enqueueAnalysis(channel, failures.map(task => task.repo), { force: true })}><RotateCcw className="mr-1 h-4 w-4" />{l('重试失败项', 'Retry failed')} {failures.length}</Button>}
    </div>
    {lastBlocked !== null && <div role="status" className="flex items-center gap-2 text-sm">{l('已屏蔽此项目', 'Project blocked')}<Button variant="link" size="sm" onClick={() => void blockCandidate({ channelId: channel.id, repoId: lastBlocked, blocked: false }).then(() => setLastBlocked(null)).catch(reportCustomError)}>{l('撤销', 'Undo')}</Button></div>}
    {issue && <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
      {issueLabel(issue, zh)}
      {issue.kind === 'auth' && <Button variant="link" onClick={() => useAppStore.getState().setCurrentView('settings')}>{l('配置 AI', 'Configure AI')}</Button>}
    </div>}
    <div className="relative flex min-w-0 items-start gap-4" data-testid="custom-results-layout">
      <div className="min-w-0 flex-1 space-y-4">
        {items.map((item, index) => <div key={item.repo.id} data-reading-key={`repo:${item.repo.id}`}><CustomRepositoryBlock item={item} repo={repositories[index]} channel={channel}
          active={activeId === item.repo.id} selected={selected.has(item.repo.id)}
          onSelect={() => setSelected(previous => { const next = new Set(previous); if (next.has(item.repo.id)) next.delete(item.repo.id); else next.add(item.repo.id); return next; })}
          onDetails={() => setActiveId(item.repo.id)} onAsk={() => setChatId(item.repo.id)}
          onAnalyze={() => request([repositories[index]])}
          onApprove={sourceEditionKey && sourcePending.has(item.repo.id) && !item.screening ? () => void handleApprove(item) : undefined}
          onBlock={() => void handleBlock(item)} /></div>)}
      </div>
      <RepositoryDetailsPanel repository={active} onClose={() => setActiveId(null)} defaultDocked onAskRepository={repo => setChatId(repo.id)}
        analysisStatus={{ running: tasks.some(task => task.repo.id === activeId && ['queued', 'waiting', 'running'].includes(task.status)), stage: tasks.find(task => task.repo.id === activeId)?.stage }}
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
