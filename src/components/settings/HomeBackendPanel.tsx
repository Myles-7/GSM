import { useEffect, useState } from 'react';
import { activateDesktopHome, confirmDesktopBootstrap, desktopSeed, getDesktopHomeSync, previewDesktopBootstrap, subscribeDesktopHome } from '../../home/desktop';
import type { PendingOperation } from '../../home/types';
import { HomeTasksPanel } from './HomeTasksPanel';

export function HomeBackendPanel() {
  const [, render] = useState(0); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewDesktopBootstrap>> | null>(null);
  const [confirmed, setConfirmed] = useState(false); const [conflicts, setConflicts] = useState<PendingOperation[]>([]);
  const sync = getDesktopHomeSync();
  useEffect(() => subscribeDesktopHome(() => { render(value => value + 1); void getDesktopHomeSync()?.db.pending().then(items => setConflicts(items.filter(item => item.conflict !== undefined))); }), []);
  const run = (fn: () => Promise<unknown>) => { setBusy(true); setMessage(''); void fn().catch(e => setMessage(e instanceof Error ? e.message : '操作失败')).finally(() => setBusy(false)); };
  const backup = async () => {
    const records = await desktopSeed();
    const blob = new Blob([JSON.stringify({ format: 'gsm-home-v2-seed', exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `gsm-home-migration-${new Date().toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('已导出业务资料快照。服务端升级前另需 SQLite 一致性备份及加密密钥。');
  };
  return <section className="space-y-4 rounded-xl border border-border p-4" aria-label="家庭电脑同步">
    <h3 className="font-semibold">家庭电脑同步 · Android</h3><p className="text-sm text-muted-foreground">手机通过 Tailscale 连接此后端；AGY 和手机 DeepSeek 的模型选择分别保存在各设备。</p>
    <div className="flex flex-wrap gap-2"><button className="rounded border px-3 py-2" disabled={busy} onClick={() => run(backup)}>导出迁移快照</button><button className="rounded border px-3 py-2" disabled={busy} onClick={() => run(async () => { const enabled = await activateDesktopHome(); if (!enabled) { setPreview(await previewDesktopBootstrap()); setConfirmed(false); } else setMessage('已启用增量同步'); })}>{sync ? '重新连接' : '连接 / 预览初始化'}</button>{sync && <button className="rounded border px-3 py-2" disabled={busy} onClick={() => run(() => sync.sync())}>立即同步</button>}</div>
    {sync && <p className="text-sm">账户 {sync.identity.githubUserId} · {sync.view.status} · 待上传 {sync.view.pending} · 冲突 {sync.view.conflicts}<br/>{sync.view.error}</p>}
    {preview && !sync && <div className="space-y-3 rounded border p-3"><h4>初始化预览</h4><pre className="text-xs">{JSON.stringify(preview.preview.counts, null, 2)}</pre><p className="text-sm">这会将当前电脑资料作为家庭工作区的初始数据，切换后旧客户端不能执行全量覆盖。</p>{preview.preview.legacyCounts && <p className="text-sm">服务端已有数据：{JSON.stringify(preview.preview.legacyCounts)}。确认后使用此次预览替换未绑定的旧业务投影。</p>}<label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />已保存快照，并确认上述账户和数据范围</label><button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={busy || !confirmed} onClick={() => run(async () => { await confirmDesktopBootstrap(preview); setPreview(null); setMessage('初始化完成。手机可使用 Tailscale HTTPS 地址连接。'); })}>确认初始化</button></div>}
    {conflicts.map(item => <div key={item.key} className="space-y-2 rounded border p-3"><strong>{item.collection} / {item.id}</strong><details><summary>查看双方版本</summary><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify({ local: item.data, server: item.conflict?.data }, null, 2)}</pre></details><div className="flex gap-2">{[[true,'保留本机修改'],[false,'使用服务器版本']].map(([keep,label]) => <button key={String(keep)} className="rounded border px-3 py-2" onClick={() => sync && run(async () => { await sync.db.resolve(item.key, keep === true); await sync.sync(); })}>{label}</button>)}</div></div>)}
    {message && <p role="status" className="text-sm">{message}</p>}
    {sync && <HomeTasksPanel key={sync.db.namespace} sync={sync} />}
  </section>;
}
