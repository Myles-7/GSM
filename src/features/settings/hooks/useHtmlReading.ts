import { useCallback, useEffect, useRef, useState } from 'react';
import { ZodError } from 'zod';
import { useAppStore } from '../../../store/useAppStore';
import { readingAccount, readingCatalog, generatePreparedReadingSnapshot, downloadReadingHtml, ReadingSizeError } from '../../../services/htmlReading';
import { defaultSettings, parseReadingReturn, settingsSchema, type ReadingReturn, type ReadingSettings, type ReadingSnapshot, snapshotItems } from '../../../lib/html-reading/model';
import { applyReadingReturn, inspectReadingReturn, inspectReadingPositions, loadReadingData, readingTransaction, saveReadingSettings, type ImportRow, type ImportPositionRow, type ReadingData } from '../../../lib/html-reading/storage';
import type { MailStatus } from '../../../lib/html-reading/desktopApi';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { previewReadingReturnBatch, applyReadingReturnBatch, type ReadingBatchPreview } from '../../../lib/html-reading/batch';
import { readingCacheStatistics } from '../../../lib/html-reading/cacheManagement';

function previewSections(snapshot: ReadingSnapshot) {
  const items=new Map(snapshotItems(snapshot).map(item=>[item.id,item]));
  const unanalyzed=(ids:number[])=>ids.filter(id=>{const item=items.get(id);return item&&!(item.hasSourceAnalysis??(!!item.summary||!!item.analysis?.length));}).length;
  return snapshot.sections.flatMap<{id:string;title:string;count:number;target?:number;available?:number;warning?:string;updatedAt?:string;sourceStatus?:string;fetched?:number;unanalyzed?:number}>(section => section.editions?.length
    ? section.editions.map(edition => ({ id: `${section.id}::${edition.id}`, title: `${section.title} · ${edition.date}`, count: edition.entries.length, target: section.targetCount, available: edition.availableCount ?? edition.entries.length, warning: [section.warning,edition.warning].filter(Boolean).join(' '),updatedAt:edition.generatedAt,unanalyzed:unanalyzed(edition.entries.map(entry=>entry.repoId)) }))
    : [{ id: section.id, title: section.title, count: section.entries?.length ?? section.items?.length ?? 0, target: section.targetCount, available: section.availableCount, warning: section.warning,updatedAt:section.updatedAt,sourceStatus:section.sourceStatus,fetched:section.fetchedCount,unanalyzed:unanalyzed(section.entries?.map(entry=>entry.repoId)??section.items?.map(item=>item.id)??[]) }]);
}

export function useHtmlReading() {
  const account = useAppStore(s=>s.isAuthenticated&&s.user?String(s.user.id):'');
  const [loadedAccount,setLoadedAccount]=useState('');
  const [settings,setSettings]=useState<ReadingSettings>(structuredClone(defaultSettings));
  const [saved,setSaved]=useState<ReadingSettings>(structuredClone(defaultSettings));const [data,setData]=useState<ReadingData|null>(null);
  const [catalog,setCatalog]=useState<{categories:Array<{id:string;name:string}>;channels:Array<{id:string;name:string}>}>({categories:[],channels:[]});
  const [mail,setMail]=useState<MailStatus>({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
  const [progress,setProgress]=useState('');
  const running=useRef(false);
  const generation=useRef<AbortController|null>(null);
  const [reportSettings,setReportSettings]=useState('');
  const [batch,setBatch]=useState<ReadingBatchPreview|null>(null);
  const [batchChoices,setBatchChoices]=useState<Record<string,string>>({});
  const [fileErrors,setFileErrors]=useState<Array<{name:string;error:string}>>([]);
  const [cacheStats,setCacheStats]=useState({entries:0,bytes:0});
  const [sizeDiagnostic,setSizeDiagnostic]=useState<ReadingSizeError['diagnostic']|undefined>();
  const activeAccount=useRef(account);activeAccount.current=account;
  useEffect(()=>{
    const api=window.electronAPI?.htmlReading;if(!account||!api?.status)return;
    let alive=true,pending=false;
    const timer=window.setInterval(()=>{if(pending)return;pending=true;void api.status().then(status=>{if(alive&&activeAccount.current===account&&readingAccount()===account)setMail(status);}).catch(()=>{}).finally(()=>{pending=false;});},5000);
    return()=>{alive=false;window.clearInterval(timer);};
  },[account]);
  const refreshCache=useCallback(()=>{if(account)void readingCacheStatistics(account).then(value=>{if(readingAccount()===account)setCacheStats(value);}).catch(()=>{});},[account]);
  useEffect(()=>{refreshCache();},[refreshCache]);
  const [generationReport,setGenerationReport]=useState<ReturnType<typeof previewSections> | null>(null);
  const [preview,setPreview]=useState<{html:string;bytes:number;count:number;uniqueCount?:number;sections?:Array<{id:string;title:string;count:number;target?:number;available?:number;warning?:string}>}|null>(null);
  const [incoming,setIncoming]=useState<ReadingReturn|null>(null);const [importRows,setImportRows]=useState<ImportRow[]>([]);const [positionRows,setPositionRows]=useState<ImportPositionRow[]>([]);const [choices,setChoices]=useState<Record<string,'phone'|'desktop'>>({});
  const reload=useCallback(async()=>{if(!account)return;const [reading,available,status]=await Promise.all([loadReadingData(account,{includeSnapshots:false}),readingCatalog(),window.electronAPI?.htmlReading?.status()??{}]);if(readingAccount()!==account)return;setData(reading);setCatalog(available);setMail(status);if(loadedAccount!==account){setSettings(reading.settings);setSaved(reading.settings);setLoadedAccount(account);}},[account,loadedAccount]);
  useEffect(()=>{let alive=true;setLoadedAccount('');setData(null);setMail({});setCatalog({categories:[],channels:[]});setIncoming(null);setImportRows([]);setPositionRows([]);setPreview(null);setGenerationReport(null);setError('');setBatch(null);setBatchChoices({});setFileErrors([]);setReportSettings('');setSizeDiagnostic(undefined);if(account)void Promise.all([loadReadingData(account,{includeSnapshots:false}),readingCatalog(),window.electronAPI?.htmlReading?.status()??{}]).then(([reading,available,status])=>{if(alive){setSettings(reading.settings);setSaved(reading.settings);setData(reading);setCatalog(available);setMail(status);setLoadedAccount(account);}}).catch(()=>{if(alive)setError('读取设置失败，请重试。');});return()=>{alive=false;};},[account]);
  const run=async(fn:()=>Promise<void>)=>{if(running.current)return;running.current=true;setBusy(true);setError('');setMessage('');setSizeDiagnostic(undefined);try{await fn();}catch(e){if(activeAccount.current===account){if(e instanceof ReadingSizeError)setSizeDiagnostic(e.diagnostic);setError(e instanceof ZodError?'填写内容的范围或格式不正确，请检查标题、数量、日期及回传格式。':e instanceof Error?e.message:'操作失败');}}finally{running.current=false;setBusy(false);setProgress('');}};
  const persistSettings=async(next:ReadingSettings)=>{await saveReadingSettings(account,next);if(readingAccount()!==account)throw Error('账户已变化');setSaved(next);const result=await window.electronAPI?.htmlReading?.configure({accountId:account,enabled:next.scheduleEnabled,time:next.sendTime,retryMode:next.retryMode,artifactRetentionDays:next.artifactRetentionDays});if(result?.success===false)throw Error(result.error);};
  const save=()=>run(async()=>{const next=settingsSchema.parse(settings);if(!next.repositories&&!next.discovery)throw Error('至少开启一个阅读页面。');await persistSettings(next);setMessage('设置已保存；定时邮件将使用已保存配置。');});
  const generate=(mode:'preview'|'export'|'send',forceRefresh=false,configuration:'current'|'saved'|'save'='current')=>run(async()=>{
    const current=settingsSchema.parse(configuration==='saved'?saved:settings);
    if(mode==='send'&&configuration==='current'&&JSON.stringify(settings)!==JSON.stringify(saved))throw Error('有未保存设置，请选择“保存并发送”或“使用已保存配置发送”。');
    if(configuration==='save')await persistSettings(current);
    const controller=new AbortController();generation.current=controller;
    try {
      const baseline=await window.electronAPI?.htmlReading?.baseline?.(account);
      const output=await generatePreparedReadingSnapshot(current,mode,setProgress,forceRefresh,{signal:controller.signal,baseline:baseline?.snapshotId?baseline.index:undefined});
      const warnings=output.snapshot.warnings??[];
      if(controller.signal.aborted)throw Error('已取消生成。');if(readingAccount()!==account)throw Error('账户已变化');
      setGenerationReport(previewSections(output.snapshot));setReportSettings(JSON.stringify(current));
      if(mode==='preview'){
        const sections=previewSections(output.snapshot);setPreview({html:output.html,bytes:output.bytes,count:sections.reduce((n,s)=>n+s.count,0),uniqueCount:snapshotItems(output.snapshot).length,sections});
        if(window.electronAPI?.htmlReading?.preview){const result=await window.electronAPI.htmlReading.preview(output.html);if(!result.success)throw Error(result.error??'独立预览打开失败。');setMessage('已打开独立预览窗口；其中标记不进入正式记录。');}
      }
      if(mode==='export'){downloadReadingHtml(output.html);setMessage('已请求下载 HTML，请确认文件保存成功。');}
      if(mode==='send'){
        const api=window.electronAPI?.htmlReading;if(!api)throw Error('邮件发送需要桌面 Electron，请重启更新后的桌面程序。');
        generation.current=null;
        const result=await api.send({accountId:account,html:output.html,snapshotId:output.snapshot.id,generatedAt:output.snapshot.generatedAt,warnings,comparisonIndex:output.snapshot.comparisonIndex});await reload();
        if(!result.success)throw Error(result.error??'发送结果未确认，请检查收件箱。');setMessage('Gmail 已接受邮件；日报比较基准已更新，请确认附件能下载和打开。');
      }
    } finally {if(generation.current===controller)generation.current=null;}
  });
  useEffect(()=>()=>{generation.current?.abort();},[account]);
  const cancelGeneration=()=>{generation.current?.abort();};
  const resend=(id:string,confirmed=false)=>run(async()=>{const result=await window.electronAPI?.htmlReading?.resend?.(account,id,confirmed);await reload();if(!result?.success)throw Error(result?.error??'当前桌面不支持补发，请升级。');setMessage('Gmail 已接受保存的附件，请确认收件箱。');});
  const cleanup=()=>run(async()=>{const result=await window.electronAPI?.htmlReading?.cleanup?.();if(!result?.success)throw Error('文件清理未完成。');await reload();setMessage(`已清理 ${result.removed??0} 份过期附件；阅读记录和回传校验资料保留。`);});
  const clearCache=()=>run(async()=>{if(readingAccount()!==account)throw Error('账户已变化');await readingCacheStatistics(account,true);refreshCache();setMessage('已清理本账户发现临时缓存；阅读记录、快照、回传回执和凭据保留。');});
  const inspectFiles=async(files:Array<{name:string;text:string}>)=>{let inspected=false;await run(async()=>{
    setBatch(null);setBatchChoices({});setIncoming(null);setFileErrors([]);
    if(!files.length||files.length>20)throw Error('每次请选择 1 至 20 份回传文件。');
    if(files.reduce((n,file)=>n+new Blob([file.text]).size,0)>20*1024*1024)throw Error('回传文件总计超过 20 MB。');
    const parsed:Parameters<typeof previewReadingReturnBatch>[1]=[],errors:Array<{name:string;error:string}>=[];
    for(const file of files){try{if(new Blob([file.text]).size>4_000_000)throw Error('单份回传文件超过 4 MB。');const input=parseReadingReturn(file.text);await previewReadingReturnBatch(account,[{name:file.name,input}]);parsed.push({name:file.name,input});}catch(error){errors.push({name:file.name,error:error instanceof ZodError?'格式不正确':error instanceof Error?error.message:'校验失败'});}}
    if(readingAccount()!==account)throw Error('账户已变化，请重新预览。');setFileErrors(errors);
    if(errors.length){setMessage('存在无效文件；请移除后重新预览，本次未修改资料。');return;}
    const result=await previewReadingReturnBatch(account,parsed);if(readingAccount()!==account)throw Error('账户已变化，请重新预览。');setBatch(result);setMessage(`已校验 ${files.length} 份独立回传文件，请检查汇总与冲突。`);inspected=true;
  });return inspected;};
  const applyBatch=()=>run(async()=>{if(!batch||fileErrors.length)throw Error('请先完成文件校验。');if(readingAccount()!==account)throw Error('账户已变化');const result=await applyReadingReturnBatch(account,batch,batchChoices);setBatch(null);setBatchChoices({});await reload();setMessage(`已应用 ${result.applied} 项，重复 ${result.duplicate} 项，保留电脑或未选修改 ${result.kept} 项；位置保存 ${result.positionApplied} 项、过期 ${result.positionStale} 项、重复 ${result.positionDuplicate} 项。收藏候选未执行 Star。`);});
  const saveMail=(from:string,to:string,password:string)=>run(async()=>{const api=window.electronAPI?.htmlReading;if(!api)throw Error('请在更新后的桌面程序中配置邮箱。');const result=await api.saveMail({accountId:account,from,to,password});if(result.success===false)throw Error(result.error);setMail(result);setMessage('邮箱授权已加密保存在本机，不进入 HTML 或业务同步。');});
  const verifyMail=()=>run(async()=>{const result=await window.electronAPI?.htmlReading?.verify(account);if(!result?.success)throw Error(result?.error??'请在桌面程序中测试连接。');setMessage('Gmail SMTP 认证通过；尚未发送邮件。');});
  const clearMail=()=>run(async()=>{const result=await window.electronAPI?.htmlReading?.clearMail();if(result?.success===false)throw Error(result.error);setMail(result??{});setMessage('邮箱授权已清除，定时发送暂停。');});
  const inspect=(text:string)=>run(async()=>{setIncoming(null);setImportRows([]);setPositionRows([]);setChoices({});const parsed=parseReadingReturn(text);const current=await loadReadingData(account,{snapshotIds:[parsed.snapshotId]});if(readingAccount()!==account)throw Error('账户已变化，请重新预览。');const rows=inspectReadingReturn(current,account,parsed);const positions=inspectReadingPositions(current,account,parsed);setIncoming(parsed);setImportRows(rows);setPositionRows(positions);setMessage(`识别 ${rows.length} 项操作${positions.length?`、${positions.length} 项继续阅读位置`:''}，确认预览后再导入。`);});
  const apply=()=>run(async()=>{if(!incoming)throw Error('请先预览回传内容。');if(readingAccount()!==account)throw Error('账户已变化，请重新预览。');const result=await applyReadingReturn(account,incoming,choices,importRows,positionRows);setIncoming(null);setImportRows([]);setPositionRows([]);await reload();const positionMessage='positionApplied'in result?`继续阅读位置已保存 ${result.positionApplied} 项，过期跳过 ${result.positionStale} 项，重复 ${result.positionDuplicate} 项。`:'';setMessage(`已应用 ${result.applied} 项，重复跳过 ${result.duplicate} 项，保留桌面 ${result.kept} 项。${positionMessage}收藏候选尚未执行 Star。`);});
  const setLocal=(repoId:string,field:'read'|'interest'|'note'|'candidate',value:string|boolean)=>run(async()=>{await readingTransaction(account,current=>{const state=current.states[repoId];if(state)Object.assign(state,{[field]:value});});await reload();setMessage('阅读记录已保存。');});
  const star=(repoId:string)=>run(async()=>{
    const state=useAppStore.getState();const name=data?.names[repoId];
    if(!name||!state.githubToken)throw Error('找不到项目或 GitHub 凭据。');
    if(!window.confirm(`确认使用当前 GitHub 账户 Star ${name}？`))return;
    const api=createGitHubApiService(state.githubToken);const coordinates=name.split('/') as [string,string];
    const repo=await api.getRepository(...coordinates);
    if(String(repo.id)!==repoId)throw Error('项目标识已变化，请先在 GitHub 核对来源。');
    if(readingAccount()!==account)throw Error('账户已变化');
    await api.starRepository(...coordinates);
    if(readingAccount()!==account)throw Error('账户已变化，请检查原账户的收藏状态。');
    const current=useAppStore.getState();
    if(!current.repositories.some(item=>item.id===repo.id)) {
      const known=Object.values(current.discoveryRepos).flat().find(item=>item.id===repo.id);
      current.addRepository({...repo,...(known?.ai_summary?{ai_summary:known.ai_summary}:{}),...(known?.ai_details?{ai_details:known.ai_details}:{}),...(known?.ai_tags?{ai_tags:known.ai_tags}:{})});
    }
    await readingTransaction(account,current=>{if(current.states[repoId])current.states[repoId].candidate=false;});
    await reload();setMessage(`已 Star ${name}。`);
  });
  return{account,ready:loadedAccount===account,settings,setSettings,saved,data,catalog,mail,busy,progress,generationReport,reportStale:!!generationReport&&reportSettings!==JSON.stringify(settings),canCancel:busy&&!!generation.current,cancelGeneration,error,message,preview,setPreview,retryLoad:()=>run(async()=>{await reload();}),save,generate,saveMail,verifyMail,clearMail,reload,inspect,incoming,importRows,positionRows,choices,setChoices,apply,setLocal,star,resend,cleanup,batch,batchChoices,setBatchChoices,fileErrors,inspectFiles,applyBatch,cacheStats,clearCache,sizeDiagnostic};
}
