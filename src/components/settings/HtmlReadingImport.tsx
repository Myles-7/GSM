import { useState } from 'react';
import type { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';
import { operationFields } from '../../lib/html-reading/model';
import { ReadingGroup, ReadingSelect } from './HtmlReadingFields';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
type Controller=ReturnType<typeof useHtmlReading>;
const valueLabel=(value:string|boolean)=>typeof value==='boolean'?(value?'是':'否'):({interested:'感兴趣',ignored:'忽略',neutral:'未标记'}[value]??value)||'空';
export function HtmlReadingImport({controller:c}:{controller:Controller}) {
  const [text,setText]=useState('');const [search,setSearch]=useState('');
  const records=Object.entries(c.data?.states??{}).filter(([id,s])=>(s.read||s.interest!=='neutral'||s.note||s.candidate)&&(c.data?.names[id]??'').toLowerCase().includes(search.toLowerCase()));
  return <>
    <ReadingGroup title="导入手机阅读记录" description="粘贴回传文本或选择回传 JSON，先预览再合并。收藏候选不会在导入时自动执行 Star。">
      <Textarea aria-label="手机回传文本" placeholder="粘贴手机导出的修改文本" value={text} onChange={e=>setText(e.target.value)} className="min-h-28"/>
      <div className="flex flex-wrap items-center gap-3"><Button disabled={c.busy||!text.trim()} onClick={()=>c.inspect(text)}>预览回传修改</Button><label className="text-sm">选择回传文件<input type="file" accept=".json,application/json" className="ml-2 max-w-full" disabled={c.busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>4000000){await c.inspect(' '.repeat(4000001));return;}const value=await file.text();setText(value);await c.inspect(value);e.target.value='';}}/></label></div>
      {c.incoming&&<div className="space-y-3"><p className="text-sm">{c.importRows.filter(r=>r.status==='ready').length} 项可应用 · {c.importRows.filter(r=>r.status==='conflict').length} 项冲突 · {c.importRows.filter(r=>r.status==='duplicate').length} 项重复</p><div className="max-h-96 space-y-3 overflow-y-auto">{c.importRows.map(row=><div key={row.op.id} className="rounded-md border p-3 text-sm"><p className="font-medium">{row.name} · {operationFields[row.op.field]}</p><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">手机：{valueLabel(row.op.value)}</p>{row.status==='conflict'?<><p className="mt-1 whitespace-pre-wrap break-words">电脑：{valueLabel(row.current)}</p><ReadingSelect label={`冲突处理 ${row.name} ${operationFields[row.op.field]}`} value={c.choices[row.op.id]??''} onChange={value=>c.setChoices(v=>({...v,[row.op.id]:value as 'phone'|'desktop'}))} options={[["","请选择"],["phone","使用手机修改"],["desktop","保留电脑内容"]]}/></>:<p className="mt-1 text-xs">{row.status==='duplicate'?'已导入，将跳过':'将应用此修改'}</p>}</div>)}</div><Button disabled={c.busy||c.importRows.some(r=>r.status==='conflict'&&!c.choices[r.op.id])} onClick={c.apply}>确认导入</Button></div>}
    </ReadingGroup>
    <ReadingGroup title="阅读记录与收藏候选" description="导入记录保存在当前电脑账户中，并用于下一份 HTML。候选需逐项确认后才加入 GitHub 收藏。">
      <input aria-label="搜索阅读记录" placeholder="搜索项目" value={search} onChange={e=>setSearch(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"/>
      <div className="max-h-96 space-y-3 overflow-y-auto">{records.slice(0,100).map(([id,state])=><article key={id} className="space-y-2 rounded-md border p-3"><a href={`https://github.com/${c.data?.names[id]}`} target="_blank" rel="noopener noreferrer" className="break-all text-sm font-medium underline">{c.data?.names[id]??id}</a><p className="text-xs text-muted-foreground">{state.read?'已读':'未读'} · {valueLabel(state.interest)}{state.candidate?' · 收藏候选':''}</p><Textarea aria-label={`阅读笔记 ${c.data?.names[id]}`} defaultValue={state.note} key={`${id}:${state.note}`} onBlur={e=>{if(e.target.value!==state.note)void c.setLocal(id,'note',e.target.value);}} maxLength={12000}/><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={c.busy} onClick={()=>c.setLocal(id,'read',!state.read)}>{state.read?'设为未读':'设为已读'}</Button><Button size="sm" variant="outline" disabled={c.busy} onClick={()=>c.setLocal(id,'interest',state.interest==='neutral'?'interested':'neutral')}>{state.interest==='neutral'?'标记感兴趣':'清除兴趣标记'}</Button>{state.candidate&&<><Button size="sm" disabled={c.busy} onClick={()=>c.star(id)}>确认 Star</Button><Button size="sm" variant="outline" disabled={c.busy} onClick={()=>c.setLocal(id,'candidate',false)}>移除候选</Button></>}</div></article>)}{records.length===0&&<p className="text-sm text-muted-foreground">尚无匹配阅读记录。</p>}{records.length>100&&<p className="text-xs text-muted-foreground">显示前 100 项，请搜索缩小范围。</p>}</div>
    </ReadingGroup>
  </>;
}
