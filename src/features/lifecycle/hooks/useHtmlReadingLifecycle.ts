import { useEffect } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { generateReadingSnapshot, readingAccount, prepareReadingSend } from '../../../services/htmlReading';
import { loadReadingData } from '../../../lib/html-reading/storage';

export function useHtmlReadingLifecycle() {
  const account=useAppStore(state=>state.hasHydrated&&state.isAuthenticated&&state.user?String(state.user.id):'');
  useEffect(()=>{
    const api=window.electronAPI?.htmlReading;if(!api)return;let alive=true;
    const unsubscribe=api.onGenerate(request=>{void(async()=>{
      if(!alive||request.accountId!==account)throw Error('当前账户与日报配置不一致。');
      const data=await loadReadingData(account);const warnings=await prepareReadingSend(data.settings);
      if(!alive||readingAccount()!==account)throw Error('账户已变化');
      const output=await generateReadingSnapshot(data.settings,warnings);if(!alive||readingAccount()!==account)throw Error('账户已变化');
      const result=await api.send({accountId:account,requestId:request.requestId,html:output.html,snapshotId:output.snapshot.id,warnings});
      if(!result.success)await api.failed(request.requestId,result.error??'发送失败');
    })().catch(()=>api.failed(request.requestId,'生成失败或账户变化，请在每日 HTML 中检查并手动重试。'));});
    const configure=()=>{void(account?loadReadingData(account).then(data=>{if(alive)return api.configure({accountId:account,enabled:data.settings.scheduleEnabled,time:data.settings.sendTime});}):api.configure(null)).catch(()=>{});};
    configure();window.addEventListener('gsm:html-reading-settings',configure);
    return()=>{alive=false;unsubscribe();window.removeEventListener('gsm:html-reading-settings',configure);};
  },[account]);
}
