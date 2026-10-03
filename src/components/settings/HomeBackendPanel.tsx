import { useEffect, useState } from 'react';
import { getDesktopHomeSync, subscribeDesktopHome } from '../../home/desktop';
import type { PendingOperation } from '../../home/types';
import { useT } from '../../i18n/useT';
import { Button } from '../ui/button';

/** Existing desktop workspaces still need conflict recovery after mobile retirement. */
export function HomeBackendPanel() {
  const t = useT('settings');
  const [, render] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState<PendingOperation[]>([]);
  const sync = getDesktopHomeSync();
  useEffect(() => {
    let live = true;
    let request = 0;
    const refresh = () => {
      render(value => value + 1);
      const current = getDesktopHomeSync();
      const token = ++request;
      if (!current) { setConflicts([]); return; }
      void current.db.pending().then(items => {
        if (live && token === request && current === getDesktopHomeSync()) setConflicts(items.filter(item => item.conflict !== undefined));
      }).catch(error => { if (live) setMessage(String(error)); });
    };
    refresh();
    const unsubscribe = subscribeDesktopHome(refresh);
    return () => { live = false; unsubscribe(); };
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMessage('');
    try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!sync) return null;
  return <section className="space-y-3 rounded-xl border border-border p-4" aria-label={t('settingsUx.desktopSync')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h4 className="text-sm font-semibold">{t('settingsUx.desktopSync')}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{t('settingsUx.syncCounts', { pending: sync.view.pending, conflicts: sync.view.conflicts })}</p></div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => sync.sync())}>{t('settingsUx.syncNow')}</Button>
    </div>
    {(message || sync.view.error) && <p role="alert" className="break-words text-sm text-destructive">{message || sync.view.error}</p>}
    {conflicts.map(item => <div key={item.key} className="space-y-2 rounded-lg border border-border p-3">
      <strong className="break-all text-sm">{item.collection} / {item.id}</strong>
      <details><summary className="cursor-pointer text-xs">{t('settingsUx.viewVersions')}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ local: item.data, server: item.conflict?.data }, null, 2)}</pre></details>
      <div className="flex flex-wrap gap-2">{[true, false].map(keep => <Button key={String(keep)} size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
        await sync.db.resolve(item.key, keep); await sync.sync();
      })}>{t(keep ? 'settingsUx.keepLocal' : 'settingsUx.useServer')}</Button>)}</div>
    </div>)}
  </section>;
}
