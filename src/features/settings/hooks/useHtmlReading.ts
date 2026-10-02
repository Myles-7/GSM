import { useCallback, useEffect, useState } from 'react';
import { ZodError } from 'zod';
import { useAppStore } from '../../../store/useAppStore';
import { readingAccount, readingCatalog, generateReadingSnapshot, prepareReadingSend, downloadReadingHtml } from '../../../services/htmlReading';
import { defaultSettings, parseReadingReturn, settingsSchema, type ReadingReturn, type ReadingSettings } from '../../../lib/html-reading/model';
import { applyReadingReturn, inspectReadingReturn, loadReadingData, readingTransaction, saveReadingSettings, type ImportRow, type ReadingData } from '../../../lib/html-reading/storage';
import type { MailStatus } from '../../../lib/html-reading/desktopApi';
import { createGitHubApiService } from '../../../services/githubApiFactory';

export function useHtmlReading() {
  const account = useAppStore(s=>s.isAuthenticated&&s.user?String(s.user.id):'');
  const [loadedAccount,setLoadedAccount]=useState('');
  const [settings,setSettings]=useState<ReadingSettings>(structuredClone(defaultSettings));
  const [saved,setSaved]=useState<ReadingSettings>(structuredClone(defaultSettings));const [data,setData]=useState<ReadingData|null>(null);
  const [catalog,setCatalog]=useState<{categories:Array<{id:string;name:string}>;channels:Array<{id:string;name:string}>}>({categories:[],channels:[]});
  const [mail,setMail]=useState<MailStatus>({});const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
  const [preview,setPreview]=useState<{html:string;bytes:number;count:number}|null>(null);
  const [incoming,setIncoming]=useState<ReadingReturn|null>(null);const [importRows,setImportRows]=useState<ImportRow[]>([]);const [choices,setChoices]=useState<Record<string,'phone'|'desktop'>>({});
  const reload=useCallback(async()=>{if(!account)return;const [reading,available,status]=await Promise.all([loadReadingData(account),readingCatalog(),window.electronAPI?.htmlReading?.status()??{}]);if(readingAccount()!==account)return;setData(reading);setCatalog(available);setMail(status);if(loadedAccount!==account){setSettings(reading.settings);setSaved(reading.settings);setLoadedAccount(account);}},[account,loadedAccount]);
  useEffect(()=>{let alive=true;setLoadedAccount('');setData(null);setMail({});setCatalog({categories:[],channels:[]});setIncoming(null);setImportRows([]);setPreview(null);setError('');if(account)void Promise.all([loadReadingData(account),readingCatalog(),window.electronAPI?.htmlReading?.status()??{}]).then(([reading,available,status])=>{if(alive){setSettings(reading.settings);setSaved(reading.settings);setData(reading);setCatalog(available);setMail(status);setLoadedAccount(account);}}).catch(()=>{if(alive)setError('读取设置失败，请重试。');});return()=>{alive=false;};},[account]);
  const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof ZodError?'填写内容的范围或格式不正确，请检查标题、数量、日期及回传格式。':e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}};
  const save=()=>run(async()=>{const next=settingsSchema.parse(settings);if(!next.repositories&&!next.discovery)throw Error('至少开启一个阅读页面。');await saveReadingSettings(account,next);if(readingAccount()!==account)throw Error('账户已变化');setSaved(next);const result=await window.electronAPI?.htmlReading?.configure({accountId:account,enabled:next.scheduleEnabled,time:next.sendTime});if(result?.success===false)throw Error(result.error);setMessage('设置已保存。预览、导出和定时邮件将使用这些内容设置。');});
  const generate=(mode:'preview'|'export'|'send')=>run(async()=>{const current=settingsSchema.parse(settings);const warnings=mode==='send'?await prepareReadingSend(current):[];const output=await generateReadingSnapshot(current,warnings);if(readingAccount()!==account)throw Error('账户已变化');if(mode==='preview')setPreview({html:output.html,bytes:output.bytes,count:output.snapshot.sections.reduce((n,s)=>n+s.items.length,0)});if(mode==='export'){downloadReadingHtml(output.html);setMessage('已请求下载 HTML，请确认文件保存成功。');}if(mode==='send'){const api=window.electronAPI?.htmlReading;if(!api)throw Error('邮件发送需要桌面 Electron，请重启更新后的桌面程序。');const result=await api.send({accountId:account,html:output.html,snapshotId:output.snapshot.id,warnings});await reload();if(!result.success)throw Error(result.error??'发送结果未确认，请检查收件箱。');setMessage('Gmail 已接受邮件。请在收件箱确认附件能下载和打开。');}});
  const saveMail=(from:string,to:string,password:string)=>run(async()=>{const api=window.electronAPI?.htmlReading;if(!api)throw Error('请在更新后的桌面程序中配置邮箱。');const result=await api.saveMail({accountId:account,from,to,password});if(result.success===false)throw Error(result.error);setMail(result);setMessage('邮箱授权已加密保存在本机，不进入 HTML 或业务同步。');});
  const verifyMail=()=>run(async()=>{const result=await window.electronAPI?.htmlReading?.verify(account);if(!result?.success)throw Error(result?.error??'请在桌面程序中测试连接。');setMessage('Gmail SMTP 认证通过；尚未发送邮件。');});
  const clearMail=()=>run(async()=>{const result=await window.electronAPI?.htmlReading?.clearMail();if(result?.success===false)throw Error(result.error);setMail(result??{});setMessage('邮箱授权已清除，定时发送暂停。');});
  const inspect=(text:string)=>run(async()=>{setIncoming(null);setImportRows([]);setChoices({});const parsed=parseReadingReturn(text);const current=await loadReadingData(account);const rows=inspectReadingReturn(current,account,parsed);setIncoming(parsed);setImportRows(rows);setMessage(`识别 ${rows.length} 项操作，确认预览后再导入。`);});
  const apply=()=>run(async()=>{if(!incoming)throw Error('请先预览回传内容。');const result=await applyReadingReturn(account,incoming,choices,importRows);setIncoming(null);setImportRows([]);await reload();setMessage(`已应用 ${result.applied} 项，重复跳过 ${result.duplicate} 项，保留桌面 ${result.kept} 项。收藏候选尚未执行 Star。`);});
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
  return{account,ready:loadedAccount===account,settings,setSettings,saved,data,catalog,mail,busy,error,message,preview,setPreview,retryLoad:()=>run(async()=>{await reload();}),save,generate,saveMail,verifyMail,clearMail,reload,inspect,incoming,importRows,choices,setChoices,apply,setLocal,star};
}
