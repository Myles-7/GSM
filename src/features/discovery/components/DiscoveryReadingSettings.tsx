import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, Eraser, Loader2, RotateCcw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '../../../components/ui/alert-dialog';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip';
import { useAppStore } from '../../../store/useAppStore';
import type { DiscoveryReadingPreferences } from '../workspace/model';

export interface DiscoveryReadingSettingsProps {
  channelName: string;
  open: boolean;
  onClose: () => void;
  preferences: DiscoveryReadingPreferences;
  onSave: (preferences: DiscoveryReadingPreferences) => Promise<void>;
  supportsLoading?: boolean;
  supportsAnalysis?: boolean;
  onResetReading: () => Promise<void>;
  onClearList: () => Promise<void>;
  onDeleteAnalysis: () => Promise<void>;
}

type Action = 'save' | 'reset' | 'clear' | 'delete';

export function DiscoveryReadingSettings(props: DiscoveryReadingSettingsProps) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      {props.open && <ReadingSettingsContent key={props.channelName} {...props} />}
    </Dialog>
  );
}

function ReadingSettingsContent({
  channelName, preferences, onClose, onSave, supportsLoading = true,
  supportsAnalysis = true, onResetReading, onClearList, onDeleteAnalysis,
}: DiscoveryReadingSettingsProps) {
  const language = useAppStore((state) => state.language);
  const l = (zh: string, en: string) => language.startsWith('zh') ? zh : en;
  const id = useId();
  const [draft, setDraft] = useState(() => ({ ...preferences }));
  const [limit, setLimit] = useState(String(preferences.autoAnalysisLimit));
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<{ action: Action; detail: string } | null>(null);
  const [completed, setCompleted] = useState<Action | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const busy = pending !== null;
  const numericLimit = Number(limit);
  const validLimit = Number.isInteger(numericLimit) && numericLimit >= 1 && numericLimit <= 10;
  const invalidLimit = supportsAnalysis && !validLimit;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const failures: Record<Action, string> = {
    save: l('保存设置失败', 'Could not save settings'),
    reset: l('重置阅读位置失败', 'Could not reset reading position'),
    clear: l('清空列表缓存失败', 'Could not clear list cache'),
    delete: l('删除 AI 分析失败', 'Could not delete AI analysis'),
  };
  const statuses: Record<Action, string> = {
    save: l('正在保存设置…', 'Saving settings…'),
    reset: l('正在重置阅读位置…', 'Resetting reading position…'),
    clear: l('正在清空列表缓存…', 'Clearing list cache…'),
    delete: l('正在删除 AI 分析…', 'Deleting AI analysis…'),
  };
  const successes: Record<Action, string> = {
    save: l('设置已保存', 'Settings saved'),
    reset: l('阅读位置已重置', 'Reading position reset'),
    clear: l('列表缓存已清空', 'List cache cleared'),
    delete: l('AI 分析已删除', 'AI analysis deleted'),
  };
  const errorMessage = error ? `${failures[error.action]}: ${error.detail}` : '';

  async function run(action: Action, command: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setPending(action);
    setError(null);
    setCompleted(null);
    let succeeded = false;
    try {
      await command();
      succeeded = true;
    } catch (cause) {
      if (mounted.current) {
        const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
        setError({ action, detail: detail || l('请重试', 'Please try again') });
      }
    } finally {
      running.current = false;
      if (mounted.current) setPending(null);
    }
    if (!mounted.current || !succeeded) return;
    setCompleted(action);
    if (action === 'delete') setConfirmDelete(false);
    if (action === 'save') onClose();
  }

  const rowClass = 'flex min-w-0 items-center justify-between gap-4 py-3';
  const labelClass = 'min-w-0 break-words text-sm font-medium';
  const cancel = l('取消', 'Cancel');
  const deleteLabel = l('删除 AI 分析', 'Delete AI analysis');

  return (
    <DialogContent
      showClose={false}
      aria-describedby={undefined}
      aria-busy={busy}
      className="inset-y-0 left-auto right-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:w-[440px] sm:max-w-[100vw] sm:border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right data-[state=open]:!zoom-in-100 data-[state=closed]:!zoom-out-100"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeButton.current?.focus();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (returnFocus.current?.isConnected) returnFocus.current.focus();
      }}
      onEscapeKeyDown={(event) => { if (running.current) event.preventDefault(); }}
      onInteractOutside={(event) => { if (running.current) event.preventDefault(); }}
    >
      <DialogHeader className="shrink-0 border-b px-5 py-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <DialogTitle className="text-base leading-snug tracking-normal">{supportsAnalysis ? l('阅读与 AI 设置', 'Reading & AI settings') : l('阅读设置', 'Reading settings')}</DialogTitle>
            <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{channelName}</p>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button ref={closeButton} type="button" variant="ghost" size="icon" className="size-10 shrink-0" disabled={busy} aria-label={l('关闭', 'Close')} onClick={onClose}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{l('关闭', 'Close')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault();
        if (!invalidLimit) void run('save', () => onSave({ ...draft, ...(supportsAnalysis ? { autoAnalysisLimit: numericLimit } : {}) }));
      }}>
        <div data-testid="reading-settings-body" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <section aria-labelledby={`${id}-reading`}>
            <h3 id={`${id}-reading`} className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4" aria-hidden="true" />{l('阅读', 'Reading')}</h3>
            <div className="mt-2 divide-y">
              <div className={rowClass}>
                <label htmlFor={`${id}-resume`} className={labelClass}>{l('继续上次阅读', 'Resume reading')}</label>
                <Switch id={`${id}-resume`} checked={draft.resumeReading} disabled={busy} onCheckedChange={(resumeReading) => setDraft((current) => ({ ...current, resumeReading }))} />
              </div>
              {supportsLoading && <>
                <div className={rowClass}>
                  <label htmlFor={`${id}-loading`} className={labelClass}>{l('加载方式', 'Loading mode')}</label>
                  <Select value={draft.loading ?? 'manual'} disabled={busy} onValueChange={(loading: DiscoveryReadingPreferences['loading']) => setDraft((current) => ({ ...current, loading }))}>
                    <SelectTrigger id={`${id}-loading`} className="w-36 shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="manual">{l('手动加载', 'Manual')}</SelectItem><SelectItem value="auto">{l('自动加载', 'Automatic')}</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className={rowClass}>
                  <label htmlFor={`${id}-batch`} className={labelClass}>{l('每次加载数量', 'Items per load')}</label>
                  <Select value={String(draft.batchSize)} disabled={busy} onValueChange={(value) => setDraft((current) => ({ ...current, batchSize: Number(value) as DiscoveryReadingPreferences['batchSize'] }))}>
                    <SelectTrigger id={`${id}-batch`} className="w-36 shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>{([20, 50, 100] as const).map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>}
              <div className={rowClass}><span className={labelClass}>{l('阅读位置', 'Reading position')}</span><Button type="button" variant="outline" disabled={busy} onClick={() => { void run('reset', onResetReading); }}><RotateCcw aria-hidden="true" />{l('重置位置', 'Reset position')}</Button></div>
              <div className={rowClass}><span className={labelClass}>{l('列表缓存', 'List cache')}</span><Button type="button" variant="outline" disabled={busy} onClick={() => { void run('clear', onClearList); }}><Eraser aria-hidden="true" />{l('清空列表缓存', 'Clear list cache')}</Button></div>
            </div>
          </section>
          {supportsAnalysis && <section aria-labelledby={`${id}-ai`} className="mt-5 border-t pt-5">
            <h3 id={`${id}-ai`} className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4" aria-hidden="true" />{l('AI 分析', 'AI analysis')}</h3>
            <div className="mt-2 divide-y">
              <div className={rowClass}>
                <label htmlFor={`${id}-analyze`} className={labelClass}>{l('自动分析', 'Automatic analysis')}</label>
                <Switch id={`${id}-analyze`} checked={draft.autoAnalyze} disabled={busy} onCheckedChange={(autoAnalyze) => setDraft((current) => ({ ...current, autoAnalyze }))} />
              </div>
              <div className={rowClass}>
                <label htmlFor={`${id}-limit`} className={labelClass}>{l('自动分析数量上限', 'Automatic analysis limit')}</label>
                <Input id={`${id}-limit`} type="number" inputMode="numeric" min={1} max={10} step={1} required value={limit} disabled={busy || !draft.autoAnalyze} aria-invalid={invalidLimit} aria-describedby={invalidLimit ? `${id}-limit-error` : undefined} className="w-24 shrink-0" onChange={(event) => setLimit(event.target.value)} />
              </div>
              {invalidLimit && <p id={`${id}-limit-error`} role="alert" className="py-2 text-sm text-destructive">{l('请输入 1 到 10 的整数', 'Enter a whole number from 1 to 10')}</p>}
              <div className={rowClass}>
                <span className={labelClass}>{l('已保存的分析', 'Saved analysis')}</span>
                <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!running.current) setConfirmDelete(open); }}>
                  <AlertDialogTrigger asChild><Button type="button" variant="outline" className="text-destructive" disabled={busy}><Trash2 aria-hidden="true" />{deleteLabel}</Button></AlertDialogTrigger>
                  <AlertDialogContent onEscapeKeyDown={(event) => { if (running.current) event.preventDefault(); }}>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="break-words">{l('删除此频道的 AI 分析？', 'Delete AI analysis for this channel?')}</AlertDialogTitle>
                      <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">{channelName}{l('：删除该频道项目的共享 AI 分析，其他频道及仓库页中的同一项目也会受到影响。保留列表缓存、阅读位置和 Star。此操作无法撤销。', ': Delete shared AI analysis for this channel’s projects. The same projects in other channels and your repository list will also be affected. List cache, reading position and Stars will be kept. This cannot be undone.')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    {pending === 'delete' && <p role="status" className="text-sm">{statuses.delete}</p>}
                    {error?.action === 'delete' && <p role="alert" className="break-words text-sm text-destructive [overflow-wrap:anywhere]">{errorMessage}</p>}
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={busy}>{cancel}</AlertDialogCancel>
                      <AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); void run('delete', onDeleteAnalysis); }}><Trash2 className="h-4 w-4" aria-hidden="true" />{deleteLabel}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </section>}
        </div>
        <footer data-testid="reading-settings-footer" className="shrink-0 space-y-3 border-t bg-card px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {!confirmDelete && error && <p role="alert" className="break-words text-sm text-destructive [overflow-wrap:anywhere]">{errorMessage}</p>}
          {!confirmDelete && (pending || completed) && <p role="status" className="text-sm text-muted-foreground">{pending ? statuses[pending] : completed ? successes[completed] : ''}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{cancel}</Button>
            <Button type="submit" disabled={busy || invalidLimit} className="min-w-24">{pending === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{l('保存', 'Save')}</Button>
          </div>
        </footer>
      </form>
    </DialogContent>
  );
}
