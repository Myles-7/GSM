import { useEffect } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { generatePreparedReadingSnapshot, readingAccount, ReadingGenerationError } from '../../../services/htmlReading';
import { loadReadingData } from '../../../lib/html-reading/storage';

export function useHtmlReadingLifecycle() {
  const account=useAppStore(state=>state.hasHydrated&&state.isAuthenticated&&state.user?String(state.user.id):'');
  useEffect(()=>{
    const api=window.electronAPI?.htmlReading;if(!api)return;let alive=true;const controllers=new Set<AbortController>();
    const unsubscribe=api.onGenerate(request=>{void(async()=>{
      if(!alive||request.accountId!==account)throw Error('当前账户与日报配置不一致。');
      const controller=new AbortController();controllers.add(controller);
      try {
        const data=await loadReadingData(account,{includeSnapshots:false,signal:controller.signal});
        if(!alive||readingAccount()!==account)throw new ReadingGenerationError('账户已变化','accountChanged');
        const baseline=await api.baseline?.(account);
        const output=await generatePreparedReadingSnapshot(data.settings,'send',undefined,false,{signal:controller.signal,baseline:baseline?.snapshotId?baseline.index:undefined,onProgress:progress=>{if(alive&&!controller.signal.aborted)void api.progress?.(request.requestId,progress.message).catch(()=>{});}});const warnings=output.snapshot.warnings??[];if(!alive||controller.signal.aborted||readingAccount()!==account)throw new ReadingGenerationError('账户已变化或生成取消','cancelled');
        const result=await api.send({accountId:account,requestId:request.requestId,html:output.html,snapshotId:output.snapshot.id,generatedAt:output.snapshot.generatedAt,warnings,comparisonIndex:output.snapshot.comparisonIndex});
        if(!result.success)await api.failed(request.requestId,result.error??'发送失败');
      } finally {controllers.delete(controller);}
    })().catch(error=>api.failed(request.requestId,error instanceof ReadingGenerationError?error.message:'生成失败，请在每日 HTML 中查看记录。',{code:error instanceof ReadingGenerationError?error.code:'generation',retryable:error instanceof ReadingGenerationError?error.retryable:false}));});
    const configure=()=>{void(account?loadReadingData(account,{includeSnapshots:false}).then(data=>{if(alive){if(!data.settings.scheduleEnabled)controllers.forEach(controller=>controller.abort());return api.configure({accountId:account,enabled:data.settings.scheduleEnabled,time:data.settings.sendTime,retryMode:data.settings.retryMode,artifactRetentionDays:data.settings.artifactRetentionDays});}}):api.configure(null)).catch(()=>{});};
    configure();window.addEventListener('gsm:html-reading-settings',configure);
    return()=>{alive=false;controllers.forEach(controller=>controller.abort());unsubscribe();window.removeEventListener('gsm:html-reading-settings',configure);};
  },[account]);
}
