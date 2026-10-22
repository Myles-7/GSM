import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useT } from '../i18n/useT';
import { Button } from './ui/button';
import { useDialog } from '../hooks/useDialog';
import { getIntlLocale } from '../i18n/format';
import { RefreshCw, UploadCloud, Info } from 'lucide-react';
import { enqueueAIClassificationRebuild } from '../services/aiClassificationRebuild';
import { retainPageTaskFailure } from '../services/pageTaskFailure';
import { readClassificationSyncView, subscribeClassificationSync, syncAIClassification, type ClassificationSyncView } from '../services/classificationSync';

export function ClassificationSchemeSwitch() {
  const t = useT('repositories');
  const { confirm, toast } = useDialog();
  const { scheme, generation, repositories, language, account, backendSecret } = useAppStore(s => ({ scheme: s.activeClassificationScheme ?? 'purpose', generation: s.classificationSchemes?.generation, repositories: s.repositories, language: s.language, account: s.user?.id, backendSecret: s.backendApiSecret }));
  const setScheme = useAppStore(s => s.setClassificationScheme);
  const [sync, setSync] = useState<ClassificationSyncView>({ status: 'local', pending: 0 });
  const [retrying, setRetrying] = useState(false);
  const [confirmingRebuild, setConfirmingRebuild] = useState(false);
  useEffect(() => {
    let mounted = true; let sequence = 0;
    const refresh = () => { const current = ++sequence; void readClassificationSyncView().then(view => { if (mounted && current === sequence) setSync(view); }).catch(() => { if (mounted && current === sequence) setSync({ status: 'error', pending: 0 }); }); };
    refresh(); const detach = subscribeClassificationSync(refresh);
    return () => { mounted = false; detach(); };
  }, [generation, repositories, account, backendSecret]);
  const running = generation?.status === 'running';
  const zh = language.startsWith('zh');
  const status = generation?.status === 'failed' ? (zh ? '分类待更新' : 'Classification pending')
    : generation?.status === 'stale' ? (zh ? 'AI 分析有新结果，待更新' : 'New AI analysis is waiting')
    : running ? (zh ? '正在更新 AI 分类' : 'Updating AI classification')
    : generation?.status === 'ready' ? `${zh ? '分类已更新' : 'Classification updated'}${generation.lastGeneratedAt ? ` · ${new Date(generation.lastGeneratedAt).toLocaleDateString(getIntlLocale(language))}` : ''}`
    : (zh ? '尚未生成 AI 分类' : 'AI classification not generated');
  const syncLabel = {
    local: zh ? '已保存到本地' : 'Saved locally', offline: zh ? '后端离线，已保存到本地' : 'Backend offline, saved locally',
    pending: zh ? '等待同步' : 'Waiting to sync', syncing: zh ? '正在同步' : 'Syncing',
    synced: zh ? '已同步' : 'Synced', conflict: zh ? '等待同步' : 'Waiting to sync', error: zh ? '等待同步' : 'Waiting to sync',
  }[sync.status];
  const details = generation?.status === 'failed' ? generation.error : sync.error;
  useEffect(() => {
    if (details && account != null) retainPageTaskFailure(String(account), 'organization', details, {
      title: zh ? '仓库分类' : 'Repository classification', target: { view: 'repositories', id: 'classification' },
    });
  }, [account, details, zh]);
  const retry = async () => { setRetrying(true); try { await syncAIClassification(); } catch { /* service retains details and the saved classification */ } finally { setRetrying(false); } };
  const rebuild = async () => {
    if (confirmingRebuild || running) return;
    const snapshot = useAppStore.getState();
    setConfirmingRebuild(true);
    try {
      if (!await confirm(t('dualOrganization.rebuildConfirmTitle'), t('dualOrganization.rebuildConfirmMessage', { count: snapshot.repositories.length }), {
        confirmText: t('dualOrganization.rebuildConfirmAction'), cancelText: t('dualOrganization.rebuildCancel'), type: 'warning',
      })) return;
      const current = useAppStore.getState();
      if (current.user?.id !== snapshot.user?.id || current.repositories !== snapshot.repositories || current.classificationSchemes !== snapshot.classificationSchemes) {
        toast(t('dualOrganization.rebuildChanged'), 'warning');
        return;
      }
      enqueueAIClassificationRebuild(current.repositories.map(repository => repository.id), { force: true, overwriteLocks: true });
    } finally { setConfirmingRebuild(false); }
  };
  return <div className="mb-3 space-y-2">
    <div className="flex gap-1 rounded-md bg-muted/50 p-1" role="group" aria-label={t('dualOrganization.scheme')}>
      {(['purpose', 'technology'] as const).map(id => <Button key={id} size="sm" variant={scheme === id ? 'secondary' : 'ghost'} aria-pressed={scheme === id} className="h-8 min-w-0 flex-1 text-xs" onClick={() => setScheme(id)}>{t(`dualOrganization.${id}Short`)}</Button>)}
    </div>
    <div className="flex items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground" role="status" aria-live="polite">
      <span className="min-w-0"><span className="block truncate" title={status}>{status}</span>{generation?.status === 'ready' && <span className="block">{syncLabel}{sync.pending > 0 ? ` · ${sync.pending} ${zh ? '项待同步' : 'pending operations'}` : ''}</span>}</span>
      <div className="flex shrink-0 items-center">
        {details && <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={zh ? '任务记录' : 'Task records'} onClick={() => useAppStore.getState().setCurrentView('tasks')}><Info size={12} /></Button>}
        {generation?.status === 'ready' && ['pending', 'offline', 'error', 'conflict'].includes(sync.status) && <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label={zh ? '重试分类同步' : 'Retry classification sync'} title={zh ? '重试分类同步' : 'Retry classification sync'} disabled={retrying} onClick={() => void retry()}><UploadCloud size={12} className={retrying ? 'animate-pulse' : ''} /></Button>}
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" aria-label={zh ? '立即重建 AI 分类' : 'Rebuild AI classification'} title={zh ? '重新生成 AI 分类，可能覆盖手动调整。' : 'Regenerate AI classification; this may overwrite manual edits.'} disabled={running || confirmingRebuild || !repositories.length} onClick={() => void rebuild()}>
          <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
        </Button>
      </div>
    </div>
  </div>;
}
