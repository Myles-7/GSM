import { useState } from 'react';
import { Calendar, ChevronDown, ChevronRight, Check, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { Modal } from '../../../components/Modal';
import { useAppStore } from '../../../store/useAppStore';
import type { ChannelDailyEdition, CustomDiscoveryChannel } from '../custom/model';
import { deleteCustomEdition, clearCustomEditions, reportCustomError } from '../custom/store';

export function getEditionKey(e: ChannelDailyEdition): string {
  return `${e.date}:${e.revision}:${e.generatedAt || ''}`;
}

export function matchEdition(e: ChannelDailyEdition, key: string): boolean {
  if (!key) return false;
  return key === getEditionKey(e) || key === `${e.date}:${e.revision}` || key === e.generatedAt;
}

export function formatNaturalDate(dateStr: string, zh: boolean, now = new Date()): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;

  const targetDate = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - targetDate.getTime()) / 86400000);

  if (diffDays === 0) {
    return zh ? `今天 ${m}月${d}日` : `Today, ${targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (diffDays === 1) {
    return zh ? `昨天 ${m}月${d}日` : `Yesterday, ${targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (diffDays === 2) {
    return zh ? `前天 ${m}月${d}日` : `${diffDays} days ago, ${targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (y === now.getFullYear()) {
    return zh ? `${m}月${d}日` : targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return zh ? `${y}年${m}月${d}日` : targetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTimeLabel(generatedAt: string | undefined, isLatest: boolean, zh: boolean): string {
  if (!generatedAt) return isLatest ? (zh ? '最新' : 'Latest') : '';
  const d = new Date(generatedAt);
  if (isNaN(d.getTime())) return isLatest ? (zh ? '最新' : 'Latest') : '';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;
  if (isLatest) {
    return `${timeStr} ${zh ? '最新' : 'Latest'}`;
  }
  const hour = d.getHours();
  let timeOfDay = '';
  if (hour < 12) timeOfDay = zh ? '早间' : 'Morning';
  else if (hour < 18) timeOfDay = zh ? '午间' : 'Afternoon';
  else timeOfDay = zh ? '晚间' : 'Evening';
  return `${timeStr} ${timeOfDay}`;
}

export interface DateEditionGroup {
  date: string;
  naturalDate: string;
  latest: ChannelDailyEdition;
  earlier: ChannelDailyEdition[];
}

export function groupEditionsByDate(editions: ChannelDailyEdition[], zh: boolean, now = new Date()): DateEditionGroup[] {
  const sorted = [...editions].sort((a, b) =>
    b.date.localeCompare(a.date)
    || (b.generatedAt || '').localeCompare(a.generatedAt || '')
    || b.revision - a.revision
  );

  const groups: DateEditionGroup[] = [];
  const map = new Map<string, ChannelDailyEdition[]>();

  for (const ed of sorted) {
    if (!map.has(ed.date)) {
      map.set(ed.date, []);
    }
    map.get(ed.date)!.push(ed);
  }

  for (const [date, items] of map.entries()) {
    groups.push({
      date,
      naturalDate: formatNaturalDate(date, zh, now),
      latest: items[0],
      earlier: items.slice(1),
    });
  }

  return groups;
}

interface CustomChannelEditionPickerProps {
  channel: CustomDiscoveryChannel;
  editions: ChannelDailyEdition[];
  selectedEditionKey?: string;
  onSelectEdition: (key: string) => void;
}

export function CustomChannelEditionPicker({
  channel,
  editions,
  selectedEditionKey,
  onSelectEdition,
}: CustomChannelEditionPickerProps) {
  const zh = useAppStore(s => s.language.startsWith('zh'));
  const l = (cnText: string, enText: string) => zh ? cnText : enText;

  const [open, setOpen] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const [deletingEdition, setDeletingEdition] = useState<ChannelDailyEdition | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const groups = groupEditionsByDate(editions, zh);
  const activeEdition = editions.find(e => selectedEditionKey ? matchEdition(e, selectedEditionKey) : false) || editions[0];
  const activeNaturalDate = activeEdition ? formatNaturalDate(activeEdition.date, zh) : '';
  const activeGroup = groups.find(g => g.date === activeEdition?.date);
  const isEarlierRun = Boolean(activeGroup && activeEdition && activeGroup.latest !== activeEdition);
  const activeTimeSuffix = isEarlierRun && activeEdition?.generatedAt
    ? ` ${formatTimeLabel(activeEdition.generatedAt, false, zh)}`
    : '';

  const handleDeleteSingle = async () => {
    if (!deletingEdition) return;
    setBusy(true);
    try {
      const deletedKey = getEditionKey(deletingEdition);
      await deleteCustomEdition(channel.id, deletedKey);
      if (selectedEditionKey && matchEdition(deletingEdition, selectedEditionKey)) {
        const remaining = editions.filter(e => !matchEdition(e, deletedKey));
        onSelectEdition(remaining[0] ? getEditionKey(remaining[0]) : '');
      }
      setDeletingEdition(null);
    } catch (err) {
      reportCustomError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleClearOld = async () => {
    setBusy(true);
    try {
      await clearCustomEditions(channel.id, { keepLatest: 1 });
      setConfirmClear(false);
      const sorted = [...editions].sort((a, b) =>
        b.date.localeCompare(a.date)
        || (b.generatedAt || '').localeCompare(a.generatedAt || '')
        || b.revision - a.revision
      );
      if (sorted[0]) {
        onSelectEdition(getEditionKey(sorted[0]));
      } else {
        onSelectEdition('');
      }
    } catch (err) {
      reportCustomError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleDateExpanded = (date: string) => {
    setExpandedDates(prev => ({ ...prev, [date]: !prev[date] }));
  };

  const renderEditionCard = (edition: ChannelDailyEdition, isLatest: boolean) => {
    const isSelected = activeEdition && matchEdition(edition, getEditionKey(activeEdition));
    const timeLabel = formatTimeLabel(edition.generatedAt, isLatest, zh);
    const key = getEditionKey(edition);

    return (
      <div
        key={key}
        onClick={() => {
          onSelectEdition(key);
          setOpen(false);
        }}
        className={`group relative flex cursor-pointer items-center justify-between rounded-md p-2 transition-all ${
          isSelected
            ? 'bg-primary/10 border border-primary/30 text-foreground'
            : 'hover:bg-accent/60 text-muted-foreground hover:text-foreground border border-transparent'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isSelected ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <div className="h-3.5 w-3.5 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <span>{timeLabel || `v${edition.revision}`}</span>
              {edition.revision !== channel.revision && (
                <span className="rounded bg-muted px-1 py-0.2 text-[10px] text-muted-foreground">
                  v{edition.revision}
                </span>
              )}
              {!edition.complete && (
                <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[10px] text-amber-600 dark:text-amber-400">
                  {l('部分完成', 'Partial')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {edition.entries.length} {l('推荐', 'recs')}
              </span>
              {edition.pending.length > 0 && (
                <>
                  <span>·</span>
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    {edition.pending.length} {l('待核实', 'unverified')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10"
          title={l('删除该期次', 'Delete edition')}
          aria-label={`${l('删除期次', 'Delete edition')} ${edition.date} ${timeLabel}`}
          onClick={(ev) => {
            ev.stopPropagation();
            setDeletingEdition(edition);
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 border-border bg-background/80 px-2.5 text-xs font-normal hover:bg-accent focus-visible:ring-1"
            aria-label={l('日期与规则版本', 'Date and rule revision')}
          >
            <Calendar className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="font-medium text-foreground">{activeNaturalDate ? `${activeNaturalDate}${activeTimeSuffix}` : activeEdition?.date}</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-muted-foreground">{activeEdition?.entries.length ?? 0} {l('推荐', 'recs')}</span>
            {(activeEdition?.pending.length ?? 0) > 0 && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                {activeEdition?.pending.length} {l('待核实', 'unverified')}
              </span>
            )}
            <ChevronDown className="ml-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-80 sm:w-88 p-0 shadow-lg" align="end">
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3.5 py-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              <span>{l('历史期次管理', 'Historical Editions')}</span>
              <span className="text-[11px] font-normal text-muted-foreground">({editions.length})</span>
            </div>
            {editions.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1 font-normal"
                onClick={() => setConfirmClear(true)}
              >
                <Sparkles className="h-3 w-3" />
                {l('一键清理旧期次', 'Clean Old')}
              </Button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5 space-y-2">
            {groups.map(group => {
              const hasEarlier = group.earlier.length > 0;
              const isExpanded = !!expandedDates[group.date];

              return (
                <div key={group.date} className="rounded-md border border-border/40 bg-card/50 p-1">
                  <div className="flex items-center justify-between px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    <span>{group.naturalDate}</span>
                    {hasEarlier && (
                      <button
                        type="button"
                        onClick={() => toggleDateExpanded(group.date)}
                        className="flex items-center gap-0.5 text-[10px] text-primary hover:underline cursor-pointer"
                      >
                        {isExpanded ? (
                          <>
                            <span>{l('收起更早记录', 'Collapse')}</span>
                            <ChevronDown className="h-2.5 w-2.5" />
                          </>
                        ) : (
                          <>
                            <span>{l(`展开当天更早 ${group.earlier.length} 次`, `Show earlier ${group.earlier.length}`)}</span>
                            <ChevronRight className="h-2.5 w-2.5" />
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {renderEditionCard(group.latest, true)}

                  {hasEarlier && isExpanded && (
                    <div className="mt-1 space-y-1 pl-2 border-l-2 border-muted ml-2">
                      {group.earlier.map(ed => renderEditionCard(ed, false))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {deletingEdition && (
        <Modal
          isOpen
          onClose={() => setDeletingEdition(null)}
          title={l('删除历史期次', 'Delete Historical Edition')}
        >
          <div className="space-y-3 pt-1">
            <p className="text-sm text-foreground/80">
              {l(
                `确定要删除 ${formatNaturalDate(deletingEdition.date, zh)}（${formatTimeLabel(deletingEdition.generatedAt, false, zh) || `v${deletingEdition.revision}`}）的生成记录吗？`,
                `Are you sure you want to delete the edition for ${formatNaturalDate(deletingEdition.date, zh)}?`
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {l(
                `该期次包含 ${deletingEdition.entries.length} 个推荐条目与 ${deletingEdition.pending.length} 个待核实条目。删除后无法恢复。`,
                `This edition contains ${deletingEdition.entries.length} recommendations. This action cannot be undone.`
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeletingEdition(null)}>
                {l('取消', 'Cancel')}
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={handleDeleteSingle}>
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {l('确认删除', 'Delete')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {confirmClear && (
        <Modal
          isOpen
          onClose={() => setConfirmClear(false)}
          title={l('一键清理历史旧期次', 'Clean Old Historical Editions')}
        >
          <div className="space-y-3 pt-1">
            <p className="text-sm text-foreground/80">
              {l(
                '确定要清理此频道的所有历史旧期次吗？',
                'Are you sure you want to clean up older editions for this channel?'
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {l(
                '系统将保留最新的 1 期推荐结果，删除其余更早的历史记录以释放存储空间。此操作不可恢复。',
                'Only the latest edition will be kept. All earlier editions will be permanently removed.'
              )}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmClear(false)}>
                {l('取消', 'Cancel')}
              </Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={handleClearOld}>
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {l('确认清理', 'Clean Old')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
