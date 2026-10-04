const crypto = require('node:crypto');
const beijingDay = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const beijingMinute = (now = new Date()) => new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
const address = value => typeof value === 'string' && /^[^\s<>@,;\r\n]{1,64}@[^\s<>@,;\r\n]{1,190}\.[a-z]{2,30}$/i.test(value);
const transient = error => ['ECONNRESET','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN','ETIMEDOUT','ESOCKET','ECONNECTION'].includes(error?.code);
const validIndex = index => !!index && typeof index === 'object' && !Array.isArray(index) && Object.keys(index).length <= 200000 && Buffer.byteLength(JSON.stringify(index)) <= 15*1024*1024 && Object.entries(index).every(([id,hash]) => /^\d+$/.test(id) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash));

function createHtmlReadingService({fs,path,userData,safeStorage,createTransport,now=()=>new Date()}) {
  const root=path.resolve(userData,'html-reading');fs.mkdirSync(root,{recursive:true});
  const stateFile=path.join(root,'delivery.json'),credentialFile=path.join(root,'gmail.enc');
  let data={formatVersion:2,plan:null,runs:[],baselines:{}};
  try {
    const previous=fs.readFileSync(stateFile,'utf8'),saved=JSON.parse(previous);
    if(!saved||!Array.isArray(saved.runs))throw Error('INVALID_DELIVERY_STATE');
    if(saved.formatVersion!==2){
      try{fs.writeFileSync(path.join(root,'delivery-before-loop.json'),previous,{encoding:'utf8',mode:0o600,flag:'wx'});}catch(error){if(error?.code!=='EEXIST')throw error;}
    }
    data={formatVersion:2,plan:saved.plan??null,runs:saved.runs,baselines:saved.baselines??{}};
  } catch(error) {if(error?.code!=='ENOENT')throw Error('日报送达记录无法读取；原文件已保留，请恢复备份后重启。');}
  let active=null;
  const persist=()=>{fs.writeFileSync(stateFile+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(stateFile+'.tmp',stateFile);};
  const scheduleRetry=(run,retryable)=>{
    const mode=data.plan?.retryMode??'safe';
    const allowed=run.kind==='scheduled' && data.plan?.enabled && data.plan.accountId===run.accountId && retryable && mode!=='manual' && (mode!=='generation'||run.phase==='generation') && (run.retryCount??0)<2 && run.date===beijingDay(now());
    if(!allowed){run.status='failed';delete run.retryAt;return;}
    run.firstFailureAt??=now().toISOString();
    const delay=(run.retryCount??0)===0?5:15;
    run.retryAt=new Date(Date.parse(run.firstFailureAt)+delay*60000).toISOString();run.status='retry_waiting';
  };
  for(const run of data.runs) {
    if(run.status==='sending')run.status='unconfirmed';
    else if(['generating','verifying'].includes(run.status)){run.phase=run.status==='verifying'?'verification':'generation';scheduleRetry(run,true);}
  }
  persist();
  const decrypt=()=>{if(!safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用，不能读取邮箱授权。');return JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialFile)));};
  const filePath=filename=>{
    if(typeof filename!=='string'||!/^GSM-\d{4}-\d{2}-\d{2}-[\w-]+\.html$/.test(filename))throw Error('附件记录无效。');
    const target=path.resolve(root,filename);if(path.dirname(target)!==root)throw Error('附件路径无效。');return target;
  };
  const artifacts=()=>data.runs.filter(run=>run.filename).flatMap(run=>{
    try {const stat=fs.lstatSync(filePath(run.filename));if(!stat.isFile()||stat.isSymbolicLink())return[];return[{id:run.id,date:run.date,status:run.status,bytes:stat.size,accountId:run.accountId}];} catch {return[];}
  });
  const cleanup=()=>{
    const cutoff=now().getTime()-(data.plan?.artifactRetentionDays??90)*86400000;
    const latest=new Map();for(const run of data.runs)if(run.status==='sent')latest.set(run.accountId,run.id);
    let removed=0;
    for(const run of data.runs) {
      if(!run.filename||Date.parse(run.completedAt??run.startedAt)>=cutoff||latest.get(run.accountId)===run.id||['sending','generating','verifying','retry_waiting','unconfirmed'].includes(run.status))continue;
      try {const target=filePath(run.filename),stat=fs.lstatSync(target);if(stat.isFile()&&!stat.isSymbolicLink()){fs.unlinkSync(target);removed++;}delete run.filename;delete run.comparisonIndex;} catch(error) {if(error?.code==='ENOENT'){delete run.filename;delete run.comparisonIndex;} }
    }
    persist();return{success:true,removed};
  };
  const status=()=>{
    let credential=null;try{const c=decrypt();credential={accountId:c.accountId,from:c.from,to:c.to,configured:true};}catch{/* No secret exposed. */}
    const files=artifacts();
    return{credential,plan:data.plan,runs:data.runs.slice(-30).reverse().map(run=>{const safe={...run};delete safe.comparisonIndex;return{...safe,hasAttachment:files.some(file=>file.id===run.id)};}),busy:!!active,storage:{files:files.length,bytes:files.reduce((n,file)=>n+file.bytes,0),retentionDays:data.plan?.artifactRetentionDays??90}};
  };
  const transport=c=>createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:c.from,pass:c.password},connectionTimeout:20000,greetingTimeout:10000,socketTimeout:45000,dnsTimeout:10000,logger:false,debug:false});
  const addRun=(accountId,kind)=>{
    const run={id:crypto.randomUUID(),accountId,kind,date:beijingDay(now()),startedAt:now().toISOString(),status:'generating',phase:'generation',retryCount:0};data.runs.push(run);persist();return run;
  };
  const service={
    status,cleanup,
    baseline(accountId){if(!/^\d+$/.test(accountId))throw Error('账户无效');const value=data.baselines[accountId];return value&&validIndex(value.index)?structuredClone(value):{index:{}};},
    saveCredential(input){
      if(active)throw Error('日报执行中，请完成后再修改邮箱配置。');
      if(!input||!/^\d+$/.test(input.accountId)||!address(input.from)||!address(input.to))throw Error('请填写有效的 Gmail 发件地址和收件地址。');
      const password=typeof input.password==='string'?input.password.replace(/\s/g,''):'';
      if(!/^[a-zA-Z0-9]{16}$/.test(password))throw Error('请填写 Google 的 16 位应用专用密码，不是账户登录密码。');
      if(!safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用，授权信息未保存。');
      fs.writeFileSync(credentialFile+'.tmp',safeStorage.encryptString(JSON.stringify({accountId:input.accountId,from:input.from.trim(),to:input.to.trim(),password})),{mode:0o600});fs.renameSync(credentialFile+'.tmp',credentialFile);return status();
    },
    clearCredential(){if(active)throw Error('任务执行中，完成后再清除邮箱配置。');if(fs.existsSync(credentialFile))fs.unlinkSync(credentialFile);data.plan=null;persist();return status();},
    async verify(accountId){const c=decrypt();if(c.accountId!==accountId)throw Error('邮箱配置属于其他 GitHub 账户。');const t=transport(c);try{await t.verify();return{success:true};}finally{t.close();}},
    configure(plan){
      if(plan&&(!/^\d+$/.test(plan.accountId)||typeof plan.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.time)||plan.retryMode!==undefined&&!['safe','manual','generation'].includes(plan.retryMode)||plan.artifactRetentionDays!==undefined&&(!Number.isInteger(plan.artifactRetentionDays)||plan.artifactRetentionDays<1||plan.artifactRetentionDays>365)))throw Error('定时配置无效。');
      if(active&&['generating','verifying'].includes(active.status)&&(plan?.accountId!==active.accountId||active.kind==='scheduled'&&!plan?.enabled)){active.status='interrupted';active.failureCode='cancelled';active=null;}
      data.plan=plan;persist();cleanup();return status();
    },
    due(){
      const p=data.plan;if(active||!p?.enabled||beijingMinute(now())<p.time)return null;
      try{if(decrypt().accountId!==p.accountId)return null;}catch{return null;}
      const today=beijingDay(now());
      for(const old of data.runs)if(old.status==='retry_waiting'&&old.date!==today){old.status='failed';delete old.retryAt;}
      const prior=data.runs.filter(r=>r.accountId===p.accountId&&r.date===today);
      if(prior.some(r=>['sent','unconfirmed','sending'].includes(r.status)))return null;
      const retry=prior.find(r=>r.kind==='scheduled'&&r.status==='retry_waiting');
      if(retry){
        if(p.retryMode==='manual'||p.retryMode==='generation'&&retry.phase!=='generation'){retry.status='failed';retry.error='自动重试策略已更改，请手动重新生成或补发。';delete retry.retryAt;persist();return null;}
        if(Date.parse(retry.retryAt)>now().getTime())return null;
        retry.retryCount=(retry.retryCount??0)+1;retry.status='generating';retry.phase='generation';delete retry.retryAt;active=retry;persist();
        return{requestId:retry.id,accountId:retry.accountId,saved:!!retry.filename};
      }
      if(prior.some(r=>r.kind==='scheduled'))return null;
      const run=addRun(p.accountId,'scheduled');active=run;return{requestId:run.id,accountId:run.accountId};
    },
    generationFailed(requestId,message,reason={}){
      if(active?.id!==requestId||active.status!=='generating')return;
      active.error=typeof message==='string'?message.slice(0,200):'生成失败';active.failureCode=typeof reason.code==='string'?reason.code.slice(0,50):'generation';active.phase='generation';
      scheduleRetry(active,reason.retryable===true);active=null;persist();
    },
    generationProgress(requestId,message){if(active?.id===requestId&&active.status==='generating'&&typeof message==='string'){active.progress=message.slice(0,200);persist();}},
    async send({accountId,requestId,html,snapshotId,generatedAt,warnings=[],comparisonIndex}){
      if(!/^\d+$/.test(accountId)||typeof html!=='string'||!html.startsWith('<!doctype html>')||Buffer.byteLength(html)>15*1024*1024||!/^[-\w]{1,100}$/.test(snapshotId)||comparisonIndex!==undefined&&!validIndex(comparisonIndex))throw Error('HTML 载荷无效或超过 15 MB。');
      const c=decrypt();if(c.accountId!==accountId)throw Error('邮箱配置属于其他 GitHub 账户。');
      if(generatedAt!==undefined&&(typeof generatedAt!=='string'||generatedAt.length>50||!Number.isFinite(Date.parse(generatedAt))))throw Error('生成时间无效。');
      if(requestId){if(!active||active.id!==requestId||active.status!=='generating'||active.accountId!==accountId||data.plan?.accountId!==accountId||!data.plan?.enabled)throw Error('日报任务已过期、已发送或账户已变化。');if(active.date!==beijingDay(now())){service.generationFailed(requestId,'已跨日，请等待今天的日报。',{code:'cancelled',retryable:false});throw Error('日报任务已跨日。');}}
      else {if(active)throw Error('已有日报任务执行中。');active=addRun(accountId,'manual');}
      const run=active,filename='GSM-'+run.date+'-'+run.id+'.html';
      run.snapshotId=snapshotId;run.generatedAt=generatedAt??now().toISOString();run.comparisonIndex=comparisonIndex;run.warnings=Array.isArray(warnings)?warnings.filter(x=>typeof x==='string').slice(0,20).map(x=>x.slice(0,500)):[];
      let t;
      try{
        fs.writeFileSync(filePath(filename)+'.tmp',html,{encoding:'utf8',mode:0o600});fs.renameSync(filePath(filename)+'.tmp',filePath(filename));run.filename=filename;
        t=transport(c);run.status='verifying';run.phase='verification';persist();await t.verify();
        if(active!==run||requestId&&(data.plan?.accountId!==accountId||!data.plan?.enabled||run.date!==beijingDay(now())))throw Object.assign(Error('任务已变化或跨日'),{code:'CANCELLED'});
        run.status='sending';run.phase='submission';persist();
        const info=await t.sendMail({from:c.from,to:c.to,subject:'GSM 每日项目阅读 · '+run.date,messageId:'<gsm-'+run.id+'@gsm.local>',text:'北京时间 '+run.date+' 的仓库与发现阅读文件已生成。实际发送：'+now().toISOString()+'。请下载 HTML 后用浏览器打开；邮箱预览可能不支持交互。阅读后导出修改并在桌面设置的“每日 HTML”中导入。\n'+run.warnings.join('\n'),attachments:[{filename:'GSM-每日阅读-'+run.date+'.html',content:html,contentType:'text/html; charset=utf-8'}],disableFileAccess:true,disableUrlAccess:true});
        if(!info.accepted?.some(value=>String(value).toLowerCase()===c.to.toLowerCase()))throw Error('NO_RECIPIENT_ACCEPTED');
        run.status='sent';run.phase='accepted';run.completedAt=now().toISOString();delete run.error;delete run.retryAt;
        if(validIndex(comparisonIndex))data.baselines[accountId]={snapshotId,index:comparisonIndex,acceptedAt:run.completedAt};
      } catch(error){
        const uncertain=run.status==='sending'&&!['EAUTH','EENVELOPE'].includes(error?.code);
        if(uncertain){run.status='unconfirmed';run.error='发送结果未确认，请先检查收件箱；不会自动重复发送。';}
        else{
          run.error=error?.code==='EAUTH'?'Gmail 认证失败，请检查应用专用密码。':error?.code==='CANCELLED'?'账户或任务已变化，未提交邮件。':'生成文件或发送前连接失败，请检查磁盘、邮箱配置与网络。';
          run.failureCode=error?.code==='EAUTH'?'authentication':error?.code==='CANCELLED'?'cancelled':'transport';
          scheduleRetry(run,run.phase==='verification'&&transient(error));
        }
      } finally {t?.close();if(active===run)active=null;persist();cleanup();}
      return{success:run.status==='sent',status:run.status,error:run.error};
    },
    async sendSavedDue(requestId){
      const run=active;if(!run||run.id!==requestId||!run.filename)throw Error('附件任务不存在');
      return service.send({accountId:run.accountId,requestId,html:fs.readFileSync(filePath(run.filename),'utf8'),snapshotId:run.snapshotId,generatedAt:run.generatedAt,warnings:run.warnings,comparisonIndex:run.comparisonIndex});
    },
    async resend(accountId,runId,confirmed=false){
      if(active)throw Error('已有日报执行中');const run=data.runs.find(r=>r.id===runId&&r.accountId===accountId);
      if(!run?.filename)throw Error('附件不存在');if(run.status==='unconfirmed'&&!confirmed)throw Error('请先检查收件箱并明确确认补发。');
      return service.send({accountId,html:fs.readFileSync(filePath(run.filename),'utf8'),snapshotId:run.snapshotId,generatedAt:run.generatedAt,warnings:run.warnings,comparisonIndex:run.comparisonIndex});
    },
  };
  cleanup();return service;
}
function registerHtmlReadingIpc({ipcMain,isMainFrame,service,getWindow,powerMonitor,openPreview}) {
  const safe=fn=>async(event,...args)=>{if(!isMainFrame(event))throw Error('HTML_IPC_DENIED');try{return await fn(...args);}catch{return{success:false,error:'操作失败，请检查账户、邮箱配置、网络或当前任务状态。'};}};
  ipcMain.handle('html-reading:status',safe(()=>service.status()));
  ipcMain.handle('html-reading:saveMail',safe(input=>service.saveCredential(input)));
  ipcMain.handle('html-reading:clearMail',safe(()=>service.clearCredential()));
  ipcMain.handle('html-reading:verify',safe(account=>service.verify(account)));
  ipcMain.handle('html-reading:configure',safe(plan=>service.configure(plan)));
  ipcMain.handle('html-reading:send',safe(input=>service.send(input)));
  ipcMain.handle('html-reading:failed',safe((id,message,reason)=>service.generationFailed(id,message,reason)));
  ipcMain.handle('html-reading:progress',safe((id,message)=>service.generationProgress(id,message)));
  ipcMain.handle('html-reading:baseline',safe(account=>service.baseline(account)));
  ipcMain.handle('html-reading:resend',safe((account,id,confirmed)=>service.resend(account,id,confirmed)));
  ipcMain.handle('html-reading:cleanup',safe(()=>service.cleanup()));
  ipcMain.handle('html-reading:preview',safe(html=>openPreview?.(html)??{success:false,error:'独立预览不可用'}));
  const tick=()=>{
    const window=getWindow();if(!window||window.isDestroyed()||window.webContents.isLoadingMainFrame()||!isMainFrame({sender:window.webContents,senderFrame:window.webContents.mainFrame}))return;
    const due=service.due();
    if(due){
      if(due.saved){void service.sendSavedDue(due.requestId).catch(()=>service.generationFailed(due.requestId,'保存附件不可用，请重新生成。'));return;}
      window.webContents.send('html-reading:generate',due);
      setTimeout(()=>service.generationFailed(due.requestId,'桌面未在时限内完成生成，请重试。',{code:'timeout',retryable:true}),180000).unref();
    }
  };
  const timer=setInterval(tick,15000);timer.unref();powerMonitor.on('resume',tick);
  return()=>{clearInterval(timer);powerMonitor.removeListener('resume',tick);};
}
module.exports={createHtmlReadingService,registerHtmlReadingIpc,beijingDay,beijingMinute};
