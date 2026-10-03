import { useEffect, useRef, useState } from 'react';
import { Bookmark, Loader2, Plus, RefreshCw, Pencil, Pause, Play, MoreHorizontal, Trash2, Eye, EyeOff, X, Clock, Zap, Settings2, ArrowUp } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/Modal';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import { useAppStore } from '../../../store/useAppStore';
import type { CustomDiscoveryChannel } from '../custom/model';
import { cancelCustomRun } from '../custom/runner';
import { reportCustomError, selectCustomChannel, startCustomRun, updateCustomData, useCustomDiscovery } from '../custom/store';
import { CustomChannelResults } from './CustomChannelResults';
import { issueLabel, progressLabel } from '../custom/taskStatus';
import { CustomChannelEditionPicker } from './CustomChannelEditionPicker';
import { useChannelEditionReading } from '../hooks/useChannelEditionReading';
import { editionKey, visibleEditionItems } from '../custom/model';
import { blockCandidate } from '../custom/candidateActions';
import { RepositoryTextSkeletons } from '../../../components/RepositoryTextBlock';
import { DiscoveryReadingSettings } from './DiscoveryReadingSettings';
import { useAutomaticDiscoveryLoading, useChannelReadingPreferences, useReadingAnchor } from '../hooks/useDiscoveryReading';
import { workspaceSessionKey } from '../workspace/model';
import { clearDiscoveryChannelWorkspace, clearDiscoveryList, loadBrowseSession, saveBrowsePage } from '../workspace/storage';
import { deleteRepositoryAnalysisAssets } from '../../../services/repositoryAnalysisAssets';
export { CustomChannelEditor } from './CustomChannelEditor';

const useLabels = () => {
  const language = useAppStore(s => s.language);
  return (zh: string, en: string) => language.startsWith('zh') ? zh : en;
};

export function CustomChannelNavigation({ mobile = false, onCreate }: { mobile?: boolean; onCreate?: () => void }) {
  const { data, selected, progress } = useCustomDiscovery();
  const l = useLabels();
  return <>
    {data.channels.filter(c => c.enabled).map(c => (
      <Button key={c.id} variant="ghost" onClick={() => selectCustomChannel(c.id)} aria-pressed={selected === c.id}
        className={`${mobile ? 'shrink-0' : 'w-full'} min-w-0 justify-between gap-2 ${selected === c.id ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}>
        <span className="flex min-w-0 items-center gap-2.5"><Bookmark className="h-4 w-4 shrink-0 text-primary" /><span className="truncate" title={c.name}>{c.name}</span></span>
        <span className="flex shrink-0 items-center gap-1 text-xs">
          {progress[c.id] ? <Loader2 className="h-3 w-3 animate-spin text-primary" /> : c.paused ? <Pause className="h-3 w-3 text-muted-foreground" /> : null}
          {!mobile && c.lastRefresh && <span className="text-muted-foreground">{new Date(c.lastRefresh).toLocaleDateString()}</span>}
        </span>
      </Button>
    ))}
    {!mobile && data.channels.length === 0 && onCreate && (
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 border border-dashed border-border/80 text-xs text-muted-foreground hover:text-foreground hover:border-border h-9 px-3"
        onClick={onCreate}
      >
        <Plus className="h-3.5 w-3.5" />
        <span>{l('创建定制 AI 频道', 'New custom channel')}</span>
      </Button>
    )}
    {!mobile && data.channels.length > 0 && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground h-8 px-2.5">
            <Eye className="h-3.5 w-3.5 shrink-0" />
            <span>{l('管理订阅频道', 'Manage subscriptions')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {data.channels.map(c => (
            <DropdownMenuItem key={c.id} onSelect={() => {
              void updateCustomData(d => { const item = d.channels.find(x => x.id === c.id); if (item) item.enabled = !item.enabled; }).catch(reportCustomError);
            }}>
              {c.enabled ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
              <span className="max-w-56 truncate">{c.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )}
    {mobile && data.channels.length > 0 && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" title={l('管理自定义频道', 'Manage custom channels')} aria-label={l('管理自定义频道', 'Manage custom channels')}>
            <Eye className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {data.channels.map(c => (
            <DropdownMenuItem key={c.id} onSelect={() => {
              void updateCustomData(d => { const item = d.channels.find(x => x.id === c.id); if (item) item.enabled = !item.enabled; }).catch(reportCustomError);
            }}>
              {c.enabled ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
              <span className="max-w-56 truncate">{c.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )}
  </>;
}

export function CustomChannelView({ channel, onEdit }: { channel: CustomDiscoveryChannel; onEdit: () => void }) {
  const l = useLabels();
  const { data, busy, progress, tasks, candidates } = useCustomDiscovery();
  const error = tasks[channel.id]?.issue ? issueLabel(tasks[channel.id].issue!, l('zh', 'en') === 'zh') : null;
  const editions = data.editions
    .filter(e => e.channelId === channel.id)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.generatedAt || '').localeCompare(a.generatedAt || '') || b.revision - a.revision);
  const reading = useChannelEditionReading(editions);
  const account = useAppStore(s => s.user ? String(s.user.id) : '');
  const root = useRef<HTMLDivElement>(null);
  const settings = useChannelReadingPreferences(account, channel.id, { autoAnalyze: channel.autoAnalyze !== false, autoAnalysisLimit: channel.autoAnalysisLimit ?? 10 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readingReady, setReadingReady] = useState(false);
  const [storageIssue, setStorageIssue] = useState(false);
  const [followingRun, setFollowingRun] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const edition = reading.edition;
  const selectedEdition = edition ? editionKey(edition) : '';
  const live = candidates[channel.id];
  const isLiveSelected = !edition || followingRun;
  const liveItems = live?.revision === channel.revision && isLiveSelected ? live.items : [];
  const pending = [...(edition?.pending || []).filter(a => !liveItems.some(item => item.repo.id === a.repo.id)), ...liveItems.map(a => ({ ...a, verdict: 'unknown' as const }))];
  const { pending: visiblePending, entries: visibleEntries } = visibleEditionItems({
    date: liveItems.length && live ? live.date : edition?.date || '',
    pending, entries: edition?.entries || [],
  }, channel);
  const items = showPending ? visiblePending : visibleEntries;
  const sessionKey = workspaceSessionKey(channel.id, `${edition?.date || ''}:${edition?.revision || channel.revision}:${showPending ? 'pending' : 'recommended'}`);
  const metaKey = workspaceSessionKey(channel.id, 'last-view');
  const [visibleCount, setVisibleCount] = useState<number>(settings.preferences.batchSize);
  const [depthKey, setDepthKey] = useState('');
  const resumeReading = settings.preferences.resumeReading;
  const showEdition = reading.show;
  const anchor = useReadingAnchor(account, sessionKey, root, resumeReading, readingReady && settings.ready && depthKey === sessionKey);
  useEffect(() => {
    if (!account || !settings.ready) return;
    let alive = true;
    setReadingReady(false);
    void loadBrowseSession(account, metaKey).then(saved => {
      if (!alive) return;
      const view = saved?.items[0];
      if (resumeReading && view?.edition) showEdition(view.edition as unknown as typeof edition);
      if (resumeReading && view?.pending !== undefined) setShowPending(view.pending === true);
      setReadingReady(true);
    }).catch(() => { if (alive) { setStorageIssue(true); setReadingReady(true); } });
    return () => { alive = false; };
    // Restore once per channel; analysis updates never reselect an edition.
  }, [account, metaKey, settings.ready, resumeReading, showEdition]);
  useEffect(() => {
    if (!readingReady || !account) return;
    let alive = true;
    void loadBrowseSession(account, sessionKey).then(saved => {
      if (!alive) return;
      const count = saved?.items[0]?.visibleCount;
      setVisibleCount(typeof count === 'number' && Number.isFinite(count) ? Math.max(1, count) : settings.preferences.batchSize);
      setDepthKey(sessionKey);
    }).catch(() => { if (alive) { setStorageIssue(true); setVisibleCount(settings.preferences.batchSize); setDepthKey(sessionKey); } });
    return () => { alive = false; };
  }, [account, sessionKey, readingReady, settings.preferences.batchSize]);
  useEffect(() => {
    if (!readingReady || depthKey !== sessionKey || !account) return;
    void saveBrowsePage(account, { key: sessionKey, channelId: channel.id, signature: sessionKey,
      items: [{ visibleCount }], itemKeys: ['depth'], nextPage: 1, hasMore: false, totalCount: 1, mode: 'replace' }).catch(() => setStorageIssue(true));
  }, [account, sessionKey, depthKey, channel.id, visibleCount, readingReady]);
  useEffect(() => {
    if (!readingReady || !edition || !account) return;
    void saveBrowsePage(account, { key: metaKey, channelId: channel.id, signature: 'last-view', items: [{ edition, pending: showPending, visibleCount }], itemKeys: ['view'],
      nextPage: 1, hasMore: false, totalCount: 1, mode: 'replace' }).catch(() => setStorageIssue(true));
  }, [account, metaKey, channel.id, edition, showPending, visibleCount, readingReady]);
  const changeTab = (value: boolean) => { anchor.persist(); setShowPending(value); };
  useAutomaticDiscoveryLoading(root, settings.preferences.loading === 'auto', false, visibleCount < items.length, false,
    () => setVisibleCount(count => count + settings.preferences.batchSize), sessionKey);
  const hasLive = liveItems.length > 0;
  const hasEntries = !!visibleEntries.length;
  useEffect(() => { if (hasLive && !hasEntries) setShowPending(true); }, [hasLive, hasEntries]);
  const changePaused = () => {
    cancelCustomRun({ channelId: channel.id });
    void updateCustomData(d => { const c = d.channels.find(x => x.id === channel.id); if (c) c.paused = !c.paused; }).catch(reportCustomError);
  };
  const refresh = async () => {
    setFollowingRun(true);
    try {
      await startCustomRun([channel.id]);
      const latest = useCustomDiscovery.getState().data.editions.filter(e => e.channelId === channel.id)
        .sort((a, b) => b.date.localeCompare(a.date) || (b.generatedAt || '').localeCompare(a.generatedAt || '') || b.revision - a.revision)[0];
      if (latest) reading.show(latest);
    } finally { setFollowingRun(false); }
  };
  return <div ref={root} className="min-w-0 flex-1 space-y-4">
    <header className="ui-toolbar space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 break-words text-lg font-semibold">{channel.name}</h2>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" title={l('回到顶部', 'Back to top')} aria-label={l('回到顶部', 'Back to top')} onClick={() => window.scrollTo({ top: 0, behavior: 'auto' })}><ArrowUp className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" title={l('频道设置', 'Channel settings')} aria-label={l('频道设置', 'Channel settings')} onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4" /></Button>
          {reading.hasUpdate && <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" title={l('已保存新一期，点击查看；当前列表保持不变。', 'A newer edition is saved. View it without changing the current list automatically.')} onClick={reading.showLatest}><RefreshCw className="h-3.5 w-3.5" />{l('有更新', 'Update available')}</Button>}
          <Button size="icon" variant="ghost" disabled={busy || channel.paused} title={l('刷新', 'Refresh')} aria-label={l('刷新', 'Refresh')} onClick={() => void refresh()}><RefreshCw className={`h-4 w-4 ${progress[channel.id] ? 'animate-spin' : ''}`} /></Button>
          {tasks[channel.id]?.status === 'loading' && <Button size="icon" variant="ghost" title={l('取消运行', 'Cancel run')} aria-label={l('取消运行', 'Cancel run')} onClick={() => cancelCustomRun({ channelId: channel.id })}><X className="h-4 w-4" /></Button>}
          <Button size="icon" variant="ghost" title={l('编辑', 'Edit')} aria-label={l('编辑', 'Edit')} onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" title={channel.paused ? l('恢复', 'Resume') : l('暂停', 'Pause')} aria-label={channel.paused ? l('恢复', 'Resume') : l('暂停', 'Pause')} onClick={changePaused}>{channel.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" title={l('更多', 'More')} aria-label={l('更多', 'More')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem onSelect={() => setShowBlocked(true)}><EyeOff className="mr-2 h-4 w-4" />{l('屏蔽记录', 'Blocked projects')} ({channel.blocked.length})</DropdownMenuItem><DropdownMenuItem onSelect={() => setConfirmDelete(true)}><Trash2 className="mr-2 h-4 w-4" />{l('删除频道', 'Delete channel')}</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="break-words text-sm text-muted-foreground">{channel.instruction}</p>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/40 text-sm">
        <div className="inline-flex rounded-lg bg-muted p-1 text-xs" role="tablist">
          <Button
            role="tab"
            size="sm"
            aria-selected={!showPending}
            variant={!showPending ? 'default' : 'ghost'}
            className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${!showPending ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => changeTab(false)}
          >
            {l('推荐', 'Recommended')}
            <span className={`ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] ${!showPending ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
              {visibleEntries.length}
            </span>
          </Button>
          <Button
            role="tab"
            size="sm"
            aria-selected={showPending}
            variant={showPending ? 'default' : 'ghost'}
            className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${showPending ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => changeTab(true)}
          >
            {l('待核实', 'Unverified')}
            {visiblePending.length > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] ${showPending ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-amber-500/20 text-amber-500 font-semibold'}`}>
                {visiblePending.length}
              </span>
            )}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1">
            <Clock className="h-3 w-3" />
            {channel.paused ? l('已暂停', 'Paused') : `${String(channel.hour).padStart(2, '0')}:00`} · {l('每日上限', 'Daily limit')} {channel.limit}
          </span>
          {editions.length > 0 && (
            <CustomChannelEditionPicker
              channel={channel}
              editions={editions}
              selectedEditionKey={selectedEdition}
              displayedEdition={edition}
              onSelectEdition={key => { anchor.persist(); reading.select(key); }}
            />
          )}
        </div>
      </div>
    </header>
    {progress[channel.id] && <p role="status" className="text-sm">{progressLabel(progress[channel.id]!, l('zh', 'en') === 'zh')}</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {edition && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 border border-border/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 font-medium text-foreground/80">
          <Zap className="h-3.5 w-3.5 text-primary" />
          {l('检索指标', 'Search metrics')}:
        </span>
        <span className="rounded bg-background/60 px-1.5 py-0.5 border border-border/30">
          {l('候选检索', 'Searched')}: <strong>{edition.searched}</strong>
        </span>
        <span className="rounded bg-background/60 px-1.5 py-0.5 border border-border/30">
          {l('规则过滤', 'Filtered')}: <strong>{edition.filtered}</strong>
        </span>
        <span className="rounded bg-background/60 px-1.5 py-0.5 border border-border/30">
          {l('生成时间', 'Generated')}: <time dateTime={edition.generatedAt}>{new Date(edition.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </span>
        {!edition.complete && <span className="text-amber-500 font-medium"> · {l('部分完成，可重试', 'Partial; retry available')}</span>}
        {edition.revision !== channel.revision && <span className="text-muted-foreground italic">({l('按历史规则 v', 'Historic v')}{edition.revision})</span>}
        {(edition.issues || []).map((e, i) => <span key={i} className="text-destructive font-medium"> · {issueLabel(e, l('zh', 'en') === 'zh')}</span>)}
      </div>
    )}
    {!items.length && !progress[channel.id] && <p className="py-12 text-center text-muted-foreground">{
      error || (edition && !edition.complete) ? l('检索未完成，请重试', 'Search incomplete. Please retry')
        : edition ? showPending ? l('暂无待核实项目', 'No unverified projects') : l('暂无符合条件的项目', 'No matching projects')
          : l('尚未生成推荐', 'No recommendations yet')
    }</p>}
    {!items.length && tasks[channel.id]?.status === 'loading' && <RepositoryTextSkeletons />}
    {(storageIssue || settings.issue || anchor.issue) && <p role="alert" className="text-sm text-destructive">{l('未保存：本地存储不可用', 'Not saved: local storage unavailable')}</p>}
    <CustomChannelResults key={`${channel.id}:${selectedEdition}:${showPending}`} items={items.slice(0, visibleCount)} channel={channel} sourceEditionKey={edition && editions.some(e => editionKey(e) === selectedEdition) ? selectedEdition : undefined} />
    {visibleCount < items.length && <div className="flex justify-center"><Button variant="outline" onClick={() => setVisibleCount(count => count + settings.preferences.batchSize)}>{l('加载更多', 'Load more')}</Button></div>}
    <DiscoveryReadingSettings channelName={channel.name} open={settingsOpen} onClose={() => setSettingsOpen(false)} preferences={settings.preferences}
      onSave={async value => { await settings.save(value); await updateCustomData(d => { const c = d.channels.find(c => c.id === channel.id); if (c) { c.autoAnalyze = value.autoAnalyze; c.autoAnalysisLimit = value.autoAnalysisLimit; } }); }}
      onResetReading={anchor.reset}
      onClearList={async () => { await clearDiscoveryList(account, metaKey); await clearDiscoveryList(account, sessionKey); setVisibleCount(settings.preferences.batchSize); }}
      onDeleteAnalysis={async () => { const ids = [...new Set(data.editions.filter(e => e.channelId === channel.id).flatMap(e => [...e.entries, ...e.pending].map(a => a.repo.id)))];
        await deleteRepositoryAnalysisAssets(account, ids);
        await updateCustomData(d => { for (const [key, record] of Object.entries(d.analyses || {})) { try { if (ids.includes(JSON.parse(key)[0]) && record.status !== 'running') delete d.analyses![key]; } catch { /* Unscoped legacy keys are not removable by channel. */ } } }); }} />
    {showBlocked && <Modal isOpen onClose={() => setShowBlocked(false)} title={l('屏蔽记录', 'Blocked projects')}>
      <div className="space-y-2">{channel.blocked.map(id => <div key={id} className="flex min-w-0 items-center justify-between gap-2 text-sm"><span className="break-all">{data.editions.flatMap(e => [...e.entries, ...e.pending]).find(a => a.repo.id === id)?.repo.full_name || `#${id}`}</span><Button variant="outline" size="sm" onClick={() => void blockCandidate({ channelId: channel.id, repoId: id, blocked: false }).catch(reportCustomError)}>{l('恢复', 'Restore')}</Button></div>)}</div>
    </Modal>}
    {confirmDelete && <Modal isOpen onClose={() => setConfirmDelete(false)} title={l('删除此频道及其本地历史？', 'Delete this channel and its local history?')}>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirmDelete(false)}>{l('取消', 'Cancel')}</Button><Button variant="destructive" onClick={() => {
        cancelCustomRun({ channelId: channel.id });
        void clearDiscoveryChannelWorkspace(account, channel.id).then(() => updateCustomData(d => {
          d.channels = d.channels.filter(c => c.id !== channel.id);
          d.editions = d.editions.filter(e => e.channelId !== channel.id);
        })).catch(reportCustomError);
      }}>{l('删除', 'Delete')}</Button></div>
    </Modal>}
  </div>;
}

export function CreateChannelButton({ onClick }: { onClick: () => void }) {
  const l = useLabels();
  return <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground" title={l('新建自定义频道', 'New custom channel')} aria-label={l('新建自定义频道', 'New custom channel')} onClick={onClick}><Plus className="h-4 w-4" /></Button>;
}
