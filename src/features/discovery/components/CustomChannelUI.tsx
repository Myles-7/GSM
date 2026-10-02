import { useEffect, useState } from 'react';
import { Bookmark, Loader2, Plus, RefreshCw, Pencil, Pause, Play, MoreHorizontal, Trash2, Eye, EyeOff, X, Clock, Zap } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/Modal';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import { useAppStore } from '../../../store/useAppStore';
import type { CustomDiscoveryChannel } from '../custom/model';
import { cancelCustomRun } from '../custom/runner';
import { reportCustomError, selectCustomChannel, startCustomRun, updateCustomData, useCustomDiscovery } from '../custom/store';
import { CustomChannelResults } from './CustomChannelResults';
import { issueLabel, progressLabel } from '../custom/taskStatus';
import { CustomChannelEditionPicker, matchEdition } from './CustomChannelEditionPicker';
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
  const { data, busy, progress, error, candidates } = useCustomDiscovery();
  const editions = data.editions
    .filter(e => e.channelId === channel.id)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.generatedAt || '').localeCompare(a.generatedAt || '') || b.revision - a.revision);
  const [selectedEdition, setSelectedEdition] = useState('');
  const [showPending, setShowPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const edition = editions.find(e => matchEdition(e, selectedEdition)) || editions[0];
  const live = candidates[channel.id];
  const isLiveSelected = !selectedEdition
    || (edition && edition.date === live?.date && edition.revision === live?.revision)
    || selectedEdition === `${live?.date}:${live?.revision}`;
  const liveItems = live?.revision === channel.revision && isLiveSelected ? live.items : [];
  const pending = [...(edition?.pending || []).filter(a => !liveItems.some(item => item.repo.id === a.repo.id)), ...liveItems.map(a => ({ ...a, verdict: 'unknown' as const }))];
  const items = (showPending ? pending : edition?.entries || []).filter(a => !channel.blocked.includes(a.repo.id));
  const hasLive = liveItems.length > 0;
  const hasEntries = !!edition?.entries.length;
  useEffect(() => { if (hasLive && !hasEntries) setShowPending(true); }, [hasLive, hasEntries]);
  const changePaused = () => {
    cancelCustomRun();
    void updateCustomData(d => { const c = d.channels.find(x => x.id === channel.id); if (c) c.paused = !c.paused; }).catch(reportCustomError);
  };
  return <div className="min-w-0 flex-1 space-y-4">
    <header className="ui-toolbar space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 break-words text-lg font-semibold">{channel.name}</h2>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" disabled={busy || channel.paused} title={l('刷新', 'Refresh')} aria-label={l('刷新', 'Refresh')} onClick={() => void startCustomRun([channel.id])}><RefreshCw className={`h-4 w-4 ${progress[channel.id] ? 'animate-spin' : ''}`} /></Button>
          {busy && <Button size="icon" variant="ghost" title={l('取消运行', 'Cancel run')} aria-label={l('取消运行', 'Cancel run')} onClick={cancelCustomRun}><X className="h-4 w-4" /></Button>}
          <Button size="icon" variant="ghost" title={l('编辑', 'Edit')} aria-label={l('编辑', 'Edit')} onClick={onEdit}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" title={channel.paused ? l('恢复', 'Resume') : l('暂停', 'Pause')} aria-label={channel.paused ? l('恢复', 'Resume') : l('暂停', 'Pause')} onClick={changePaused}>{channel.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" title={l('更多', 'More')} aria-label={l('更多', 'More')}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem onSelect={() => setConfirmDelete(true)}><Trash2 className="mr-2 h-4 w-4" />{l('删除频道', 'Delete channel')}</DropdownMenuItem></DropdownMenuContent>
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
            onClick={() => setShowPending(false)}
          >
            {l('推荐', 'Recommended')}
            <span className={`ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] ${!showPending ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
              {edition?.entries.length ?? 0}
            </span>
          </Button>
          <Button
            role="tab"
            size="sm"
            aria-selected={showPending}
            variant={showPending ? 'default' : 'ghost'}
            className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${showPending ? 'shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setShowPending(true)}
          >
            {l('待核实', 'Unverified')}
            {pending.length > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.2 text-[10px] ${showPending ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-amber-500/20 text-amber-500 font-semibold'}`}>
                {pending.length}
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
              onSelectEdition={setSelectedEdition}
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
    <CustomChannelResults key={`${channel.id}:${selectedEdition}:${showPending}`} items={items} channel={channel} />
    {confirmDelete && <Modal isOpen onClose={() => setConfirmDelete(false)} title={l('删除此频道及其本地历史？', 'Delete this channel and its local history?')}>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirmDelete(false)}>{l('取消', 'Cancel')}</Button><Button variant="destructive" onClick={() => {
        cancelCustomRun();
        void updateCustomData(d => {
          d.channels = d.channels.filter(c => c.id !== channel.id);
          d.editions = d.editions.filter(e => e.channelId !== channel.id);
        }).catch(reportCustomError);
      }}>{l('删除', 'Delete')}</Button></div>
    </Modal>}
  </div>;
}

export function CreateChannelButton({ onClick }: { onClick: () => void }) {
  const l = useLabels();
  return <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground" title={l('新建自定义频道', 'New custom channel')} aria-label={l('新建自定义频道', 'New custom channel')} onClick={onClick}><Plus className="h-4 w-4" /></Button>;
}
