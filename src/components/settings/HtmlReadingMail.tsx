import { useEffect, useState } from 'react';
import type { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';
import { ReadingGroup, ReadingToggle } from './HtmlReadingFields';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
export function HtmlReadingMail({controller:c}:{controller:ReturnType<typeof useHtmlReading>}) {
  const [from,setFrom]=useState('');const [to,setTo]=useState('');const [password,setPassword]=useState('');
  const credential=c.mail.credential?.accountId===c.account?c.mail.credential:null;
  useEffect(()=>{setFrom(credential?.from??'');setTo(credential?.to??'');setPassword('');},[credential?.from,credential?.to,c.account]);
  const apiAvailable=!!window.electronAPI?.htmlReading;
  return <ReadingGroup title="Gmail 与每日发送" description="每天按北京时间生成并发送附件。仅使用已有 AI 内容，日报流程不新增模型调用。">
    {!apiAvailable&&<p className="rounded-md bg-muted p-3 text-sm">当前运行环境尚未提供邮件接口。预览和导出可用；邮件配置需要更新后重新启动 Electron 桌面程序。</p>}
    <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-sm"><span>Gmail 发件地址</span><Input type="email" value={from} onChange={e=>setFrom(e.target.value)} autoComplete="off"/></label><label className="space-y-2 text-sm"><span>收件地址</span><Input type="email" value={to} onChange={e=>setTo(e.target.value)} autoComplete="off"/></label></div>
    <label className="block space-y-2 text-sm"><span>Google 应用专用密码</span><Input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={credential?'已有加密授权；填写新密码以替换':'16 位应用专用密码，不是登录密码'} autoComplete="new-password"/></label>
    <p className="text-xs text-muted-foreground">需要 Google 两步验证且账户支持应用专用密码。授权只保存在本机安全存储中。<a className="ml-1 underline" href="https://support.google.com/accounts/answer/185833" target="_blank" rel="noopener noreferrer">Google 配置说明</a></p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={c.busy||!apiAvailable||!from||!to||password.replace(/\s/g,'').length!==16} onClick={async()=>{await c.saveMail(from,to,password);setPassword('');}}>保存加密授权</Button><Button variant="outline" disabled={c.busy||!credential||!apiAvailable} onClick={c.verifyMail}>测试连接（不发邮件）</Button><Button variant="ghost" disabled={c.busy||!credential||!apiAvailable} onClick={c.clearMail}>清除授权</Button></div>
    <ReadingToggle label="启用每日邮件" checked={c.settings.scheduleEnabled} onChange={value=>c.setSettings(s=>({...s,scheduleEnabled:value}))} hint="保存后生效；GSM 需保持运行。未配置本账户邮箱时不会发送。"/>
    <label className="block space-y-2 text-sm"><span>每日生成并发送时间（北京时间）</span><Input type="time" value={c.settings.sendTime} onChange={e=>c.setSettings(s=>({...s,sendTime:e.target.value}))}/></label>
    <ReadingToggle label="发送前更新所选内置发现频道" checked={c.settings.refreshBeforeSend} onChange={value=>c.setSettings(s=>({...s,refreshBeforeSend:value}))} hint="各频道有等待上限；失败沿用旧内容。自定义频道使用桌面已生成期刊，不额外调用 AI。08:00 开始更新，邮件会在生成完成后发出。"/>
    <ReadingToggle label="等待正在进行的桌面自定义发现更新" checked={c.settings.waitForDiscovery} onChange={value=>c.setSettings(s=>({...s,waitForDiscovery:value}))} hint="最多等待 60 秒，只等待已有任务完成，不触发新任务。超时使用已保存期刊，HTML 标注实际更新时间。"/>
    <div className="flex flex-wrap gap-2"><Button disabled={c.busy||!credential||!apiAvailable} onClick={()=>c.generate('send')}>立即生成并发送</Button><Button variant="ghost" disabled={c.busy} onClick={()=>void c.reload()}>刷新发送记录</Button></div>
    <p className="text-xs text-muted-foreground">附件需下载后用浏览器打开，邮箱预览可能不支持交互。Gmail SMTP 需要电脑网络能连接 smtp.gmail.com:465，不沿用桌面 HTTP 代理。发送结果不确定时不会自动重发，先检查收件箱；电脑休眠或退出 GSM 会错过发送，恢复运行后检查当天任务。</p>
    {(c.mail.runs??[]).filter(run=>run.accountId===c.account).slice(0,8).map(run=><div key={run.id} className="border-t pt-2 text-xs"><p>{run.date} · {({sent:'Gmail 已接受',generating:'生成中',sending:'发送中',failed:'失败',unconfirmed:'发送结果未确认',interrupted:'执行中断'} as Record<string,string>)[run.status]??run.status}</p>{run.error&&<p className="text-muted-foreground">{run.error}</p>}</div>)}
  </ReadingGroup>;
}
