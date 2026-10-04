import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { useAppStore } from '../../store/useAppStore';
import type { LocalBackup } from '../../services/localBackup';
import { getLocalBackupIdentity } from '../../services/localBackupScope';
import { planLocalBackupRestore, safeBackupTypes, type LocalRestorePlan, type SafeBackupType } from '../../services/localBackupRestorePlan';
import { executeLocalBackupRestore, recoverLocalBackupRestore, readLocalBackupRestoreJournal, type LocalRestoreJournal } from '../../services/localBackupRestore';

const eventName = 'gsm:local-backup-recovery';
const notify = () => window.dispatchEvent(new Event(eventName));
export function LocalBackupRecoveryPanel() {
  const zh = useAppStore(state => state.language) === 'zh';
  const [journal, setJournal] = useState<LocalRestoreJournal | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const refresh = useCallback(() => { void readLocalBackupRestoreJournal().then(setJournal).catch(err => setError(String(err))); }, []);
  useEffect(() => { refresh(); window.addEventListener(eventName, refresh); return () => window.removeEventListener(eventName, refresh); }, [refresh]);
  if (!journal && !error) return null;
  const recover = async (undo: boolean) => {
    setBusy(true); setError('');
    try { await recoverLocalBackupRestore(undo); setJournal(null); }
    catch (err) { setError(String(err)); }
    finally { setBusy(false); refresh(); }
  };
  return <section className="rounded-lg border border-warning/40 p-4 space-y-3" aria-label={zh ? '备份恢复中断' : 'Interrupted backup restore'}>
    <p>{zh ? '上次安全恢复未完成。资料写入已暂停，请继续或撤回；账户或工作区发生变化时不会写入。' : 'An interrupted restore has paused data writes. Continue or undo it; account or workspace changes will block writes.'}</p>
    {journal && <><p>{journal.summary}</p><div className="flex gap-2">
      <Button disabled={busy} onClick={() => recover(false)}>{zh ? '继续恢复' : 'Continue restore'}</Button>
      <Button variant="outline" disabled={busy} onClick={() => recover(true)}>{zh ? '撤回恢复' : 'Undo restore'}</Button>
    </div></>}
    {error && <p role="alert" className="text-destructive break-words">{error}</p>}
  </section>;
}

export function LocalBackupRestorePanel({ backup, legacyConfirmed, disabled, onBusyChange }: { backup: LocalBackup; legacyConfirmed: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const zh = useAppStore(state => state.language) === 'zh';
  const [selected, setSelected] = useState<SafeBackupType[]>([]);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [plan, setPlan] = useState<LocalRestorePlan | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const available = safeBackupTypes(backup.data);
  const labels: Record<SafeBackupType, string> = { repositories: zh ? '仓库资料与归属' : 'Repositories and membership', customCategories: zh ? '分类、子分类与顺序' : 'Categories, groups and order', uiSettings: zh ? '界面偏好（不含连接和凭据）' : 'UI preferences (excluding connections and credentials)' };
  useEffect(() => { setPlan(null); setSelected([]); setError(''); setMessage(''); }, [backup]);
  useEffect(() => { setPlan(null); }, [legacyConfirmed]);
  if (!available.length) return null;
  const preview = () => {
    setError(''); setMessage('');
    try { setPlan(planLocalBackupRestore(useAppStore.getState(), backup, selected, mode, getLocalBackupIdentity(selected.some(type => type !== 'uiSettings')), legacyConfirmed)); }
    catch (err) { setPlan(null); setError(String(err)); }
  };
  const execute = async () => {
    if (!plan) return;
    setBusy(true); onBusyChange(true); setError('');
    try {
      const result = await executeLocalBackupRestore(plan); setPlan(null);
      setMessage(result.homePending ? (zh ? '本机已恢复；Home 操作已入队，等待同步确认。' : 'Restored locally; Home operations are queued for sync confirmation.') : (zh ? '本机已恢复并验证保存。' : 'Restored and verified locally.'));
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); onBusyChange(false); notify(); }
  };
  const blocked = disabled || busy || (!backup.identity && !legacyConfirmed);
  return <section className="border rounded-lg p-4 space-y-3" aria-label={zh ? '安全恢复' : 'Safe restore'}>
    <h4 className="font-medium">{zh ? '安全恢复' : 'Safe restore'}</h4>
    <p className="text-sm text-muted-foreground">{zh ? '仅处理选中范围。合并保留当前同 ID 整理成果，追加新 ID；选中的偏好按备份恢复。替换只作用于备份明确包含的字段。' : 'Only selected sections are restored. Merge keeps current records with the same ID and appends new IDs; selected preferences follow the backup. Replace only affects explicitly included fields.'}</p>
    {available.map(type => <label key={type} className="flex gap-2 text-sm"><input type="checkbox" disabled={blocked} checked={selected.includes(type)} onChange={event => { setPlan(null); setSelected(values => event.target.checked ? [...values, type] : values.filter(item => item !== type)); }} />{labels[type]}</label>)}
    <label className="flex gap-2 text-sm">{zh ? '恢复方式' : 'Restore mode'}<select disabled={blocked} value={mode} onChange={event => { setMode(event.target.value as 'merge' | 'replace'); setPlan(null); }} className="bg-background border rounded"><option value="merge">{zh ? '合并' : 'Merge'}</option><option value="replace">{zh ? '替换选中范围' : 'Replace selected sections'}</option></select></label>
    <Button variant="outline" disabled={blocked || !selected.length} onClick={preview}>{zh ? '预览安全恢复' : 'Preview safe restore'}</Button>
    {plan && <><pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap" aria-label={zh ? '恢复变更预览' : 'Restore changes preview'}>{plan.summary}</pre><Button disabled={blocked} onClick={execute}>{zh ? '确认执行安全恢复' : 'Confirm safe restore'}</Button></>}
    {error && <p role="alert" className="text-destructive break-words">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
