import { FileText, Download, Eye, Save, Loader2 } from 'lucide-react';
import { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';
import { analysisFields, contentFields, operationFields } from '../../lib/html-reading/model';
import { ReadingFlags, ReadingGroup, ReadingNumber, ReadingSelect, ReadingToggle } from './HtmlReadingFields';
import { HtmlReadingImport } from './HtmlReadingImport';
import { HtmlReadingMail } from './HtmlReadingMail';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { useState } from 'react';
import { useT } from '../../i18n/useT';

export function HtmlReadingPanel() {
  const t = useT('settings');
  const [section, setSection] = useState('content');
  const c=useHtmlReading();const s=c.settings;const set=c.setSettings;
  const dirty=JSON.stringify(s)!==JSON.stringify(c.saved);
  const select=(key:'categoryIds'|'channelIds',id:string,value:boolean)=>set(old=>({...old,[key]:value?[...old[key],id]:old[key].filter(x=>x!==id)}));
  if(!c.account)return <p className="p-4 text-muted-foreground">请登录 GitHub 后配置每日 HTML。</p>;
  if(!c.ready)return <div className="space-y-3 p-4"><p role={c.error?'alert':'status'} className="text-muted-foreground">{c.error||'正在读取本账户的每日 HTML 设置…'}</p>{c.error&&<Button variant="outline" disabled={c.busy} onClick={c.retryLoad}>重新读取</Button>}</div>;
  return <div className="space-y-5">
    <div className="flex items-start gap-3"><FileText className="mt-1 h-6 w-6 shrink-0 text-muted-foreground"/><div><h3 className="text-lg font-semibold">每日 HTML</h3><p className="mt-1 text-sm text-muted-foreground">决定手机阅读文件的内容、样式和可回传操作。只复用已有 AI 摘要与分析。</p></div></div>
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3"><Button disabled={c.busy} onClick={c.save}><Save className="mr-2 h-4 w-4"/>保存设置</Button><Button variant="outline" disabled={c.busy} onClick={()=>c.generate('preview')}><Eye className="mr-2 h-4 w-4"/>预览 HTML</Button><Button variant="outline" disabled={c.busy} onClick={()=>c.generate('export')}><Download className="mr-2 h-4 w-4"/>导出 HTML</Button>{c.busy?<span className="flex items-center gap-2 text-xs" role="status"><Loader2 className="h-4 w-4 animate-spin"/>正在处理…</span>:<span className="text-xs text-muted-foreground">{dirty?'有未保存设置；预览和手动导出使用当前表单':'已保存'}</span>}</div>
    {c.error&&<p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{c.error}</p>}{c.message&&<p role="status" className="rounded-md bg-muted p-3 text-sm">{c.message}</p>}
    <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('settingsUx.readingOptions')}>
      {['content', 'layout', 'mail', 'records'].map(id => <Button key={id} variant={section === id ? 'secondary' : 'ghost'} size="sm" role="tab" id={`reading-tab-${id}`} aria-selected={section === id} aria-controls={`reading-panel-${id}`} onClick={() => setSection(id)}>{t(`settingsUx.readingTabs.${id}`)}</Button>)}
    </div>
    <div role="tabpanel" id="reading-panel-content" aria-labelledby="reading-tab-content" hidden={section !== 'content'} className="space-y-4">
    <ReadingGroup title="页面与仓库范围">
      <label className="block space-y-2 text-sm"><span>HTML 标题</span><Input maxLength={80} value={s.title} onChange={e=>set(v=>({...v,title:e.target.value}))}/></label>
      <div className="grid gap-2 sm:grid-cols-2"><ReadingToggle label="包含收藏仓库" checked={s.repositories} onChange={value=>set(v=>({...v,repositories:value}))}/><ReadingToggle label="包含发现" checked={s.discovery} onChange={value=>set(v=>({...v,discovery:value}))}/></div>
      {s.repositories&&<><p className="text-sm font-medium">仓库分类范围</p><p className="text-xs text-muted-foreground">不选分类代表全部；选择分类后只导出这些仓库。</p><div className="grid max-h-60 gap-2 overflow-auto sm:grid-cols-2">{[...c.catalog.categories,{id:'none',name:'未分类'}].map(cat=><ReadingToggle key={cat.id} label={cat.name} checked={s.categoryIds.includes(cat.id)} onChange={value=>select('categoryIds',cat.id,value)}/>)}</div><div className="grid gap-4 sm:grid-cols-2"><ReadingNumber label="仓库数量上限" value={s.repositoryLimit} min={1} max={10000} onChange={value=>set(v=>({...v,repositoryLimit:value}))}/><ReadingSelect label="仓库默认排序" value={s.repositorySort} options={[["stars","Star 数量"],["updated","最近更新"],["name","项目名称"]]} onChange={value=>set(v=>({...v,repositorySort:value as typeof s.repositorySort}))}/></div></>}
      <div className="grid gap-2 sm:grid-cols-2"><ReadingToggle label="只导出未读项目" checked={s.unreadOnly} onChange={value=>set(v=>({...v,unreadOnly:value}))}/><ReadingToggle label="隐藏已忽略项目" checked={s.hideIgnored} onChange={value=>set(v=>({...v,hideIgnored:value}))}/></div>
    </ReadingGroup>
    {s.discovery&&<ReadingGroup title="发现频道与历史" description="选择最终文件中出现的频道。导出已有桌面内容，不会因为预览或导出而执行 AI。">
      <div className="grid gap-2 sm:grid-cols-2">{c.catalog.channels.map(channel=><ReadingToggle key={channel.id} label={channel.name} checked={s.channelIds.includes(channel.id)} onChange={value=>select('channelIds',channel.id,value)}/>)}</div>
      <div className="grid gap-4 sm:grid-cols-2"><ReadingNumber label="每个频道项目上限" value={s.perChannel} min={1} max={500} onChange={value=>set(v=>({...v,perChannel:value}))}/><ReadingNumber label="自定义期刊回看天数" value={s.historyDays} min={1} max={90} onChange={value=>set(v=>({...v,historyDays:value}))}/></div><p className="text-xs text-muted-foreground">内置频道使用已加载的桌面结果；未加载内容不会凭空补齐。相同项目按 ID 去重，频道展示更新时间。发现设置不修改桌面频道配置。</p>
    </ReadingGroup>}
    </div>
    <div role="tabpanel" id="reading-panel-layout" aria-labelledby="reading-tab-layout" hidden={section !== 'layout'} className="space-y-4">
    <ReadingGroup title="卡片、详情与依据" description="缺失内容自动隐藏。关闭字段后，相应内容从文件数据中排除，而不只是隐藏界面。">
      <ReadingFlags labels={contentFields} values={s.fields} onChange={(key,value)=>set(v=>({...v,fields:{...v.fields,[key]:value}}))}/>
      <ReadingNumber label="每个项目 AI 摘要最多字符" min={100} max={2000} value={s.summaryChars} onChange={value=>set(v=>({...v,summaryChars:value}))}/>
      <p className="text-sm font-medium">详情中的 AI 分析栏目</p><ReadingFlags labels={analysisFields} values={s.analysis} onChange={(key,value)=>set(v=>({...v,analysis:{...v.analysis,[key]:value}}))}/>
      <p className="text-xs text-muted-foreground">已有笔记默认不随邮件发送。开启阅读笔记编辑仍可写新笔记；电脑已有笔记不同则导入时显示冲突。</p>
    </ReadingGroup>
    <ReadingGroup title="阅读样式与文件大小"><div className="grid gap-4 sm:grid-cols-2">
      <ReadingSelect label="默认页面" value={s.initialPage} options={[["repositories","仓库"],["discovery","发现"]]} onChange={value=>set(v=>({...v,initialPage:value as typeof s.initialPage}))}/>
      <ReadingSelect label="主题" value={s.theme} options={[["system","跟随手机系统"],["light","浅色"],["dark","深色"]]} onChange={value=>set(v=>({...v,theme:value as typeof s.theme}))}/>
      <ReadingSelect label="正文字号" value={s.fontSize} options={['14','16','18','20'].map(size=>[size,`${size}px`])} onChange={value=>set(v=>({...v,fontSize:value as typeof s.fontSize}))}/>
      <ReadingSelect label="卡片密度" value={s.density} options={[["compact","紧凑"],["standard","标准"]]} onChange={value=>set(v=>({...v,density:value as typeof s.density}))}/>
      <ReadingNumber label="HTML 文件大小上限（MB）" value={s.maxFileMb} min={1} max={15} onChange={value=>set(v=>({...v,maxFileMb:value}))}/>
    </div><p className="text-xs text-muted-foreground">单文件离线阅读，不内置 README、图片或模型凭据。超出上限时明确提示调整，不静默丢弃项目。</p></ReadingGroup>
    <ReadingGroup title="手机可以修改什么" description="仅导出这些操作；人工分类留在电脑，收藏候选回桌面确认。"><ReadingFlags labels={operationFields} values={s.operations} onChange={(key,value)=>set(v=>({...v,operations:{...v.operations,[key]:value}}))}/></ReadingGroup>
    </div>
    <div role="tabpanel" id="reading-panel-mail" aria-labelledby="reading-tab-mail" hidden={section !== 'mail'}><HtmlReadingMail controller={c}/></div>
    <div role="tabpanel" id="reading-panel-records" aria-labelledby="reading-tab-records" hidden={section !== 'records'} className="space-y-4"><HtmlReadingImport controller={c}/></div>
    <Dialog modal={false} open={!!c.preview} onOpenChange={open=>{if(!open)c.setPreview(null);}}><DialogContent className="flex h-[90vh] max-w-4xl flex-col" aria-describedby={undefined}><DialogTitle>实际 HTML 预览</DialogTitle><p className="text-xs text-muted-foreground">{c.preview?.count} 个频道项目条目 · {((c.preview?.bytes??0)/1024/1024).toFixed(2)} MB · 预览中的标记与桌面隔离</p>{c.preview&&<iframe title="每日 HTML 预览" srcDoc={c.preview.html} sandbox="allow-scripts allow-downloads allow-popups" className="min-h-0 w-full flex-1 rounded-md border"/>}</DialogContent></Dialog>
  </div>;
}
