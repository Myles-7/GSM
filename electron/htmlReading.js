const crypto = require('node:crypto');

function beijingDay(now = new Date()) { return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
function beijingMinute(now = new Date()) { return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now); }
const address = value => typeof value === 'string' && /^[^\s<>@,;\r\n]{1,64}@[^\s<>@,;\r\n]{1,190}\.[a-z]{2,30}$/i.test(value);
function createHtmlReadingService({fs,path,userData,safeStorage,createTransport,now=()=>new Date()}) {
  const root=path.join(userData,'html-reading');fs.mkdirSync(root,{recursive:true});
  const stateFile=path.join(root,'delivery.json'),credentialFile=path.join(root,'gmail.enc');
  let data={plan:null,runs:[]};try{const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(Array.isArray(saved.runs))data={plan:saved.plan??null,runs:saved.runs};}catch{/* First run. */}
  // An SMTP response may have been lost during shutdown. Never auto-repeat that send.
  for(const run of data.runs)if(['generating','sending'].includes(run.status))run.status=run.status==='sending'?'unconfirmed':'interrupted';
  let active=null;
  const persist=()=>{fs.writeFileSync(stateFile+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(stateFile+'.tmp',stateFile);};persist();
  const decrypt=()=>{if(!safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用，不能读取邮箱授权。');return JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialFile)));};
  const status=()=>{let credential=null;try{const c=decrypt();credential={accountId:c.accountId,from:c.from,to:c.to,configured:true};}catch{/* No usable secret. */}return{credential,plan:data.plan,runs:data.runs.slice(-20).reverse(),busy:!!active};};
  const transport=c=>createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:c.from,pass:c.password},connectionTimeout:20000,greetingTimeout:10000,socketTimeout:45000,dnsTimeout:10000,logger:false,debug:false});
  const addRun=(accountId,kind)=>{const run={id:crypto.randomUUID(),accountId,kind,date:beijingDay(now()),startedAt:now().toISOString(),status:'generating'};data.runs.push(run);data.runs=data.runs.slice(-50);persist();return run;};
  return {
    status,
    saveCredential(input){
      if(!input||!/^\d+$/.test(input.accountId)||!address(input.from)||!address(input.to))throw Error('请填写有效的 Gmail 发件地址和收件地址。');
      const password=typeof input.password==='string'?input.password.replace(/\s/g,''):'';
      if(!/^[a-zA-Z0-9]{16}$/.test(password))throw Error('请填写 Google 的 16 位应用专用密码，不是账户登录密码。');
      if(!safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用，授权信息未保存。');
      fs.writeFileSync(credentialFile+'.tmp',safeStorage.encryptString(JSON.stringify({accountId:input.accountId,from:input.from.trim(),to:input.to.trim(),password})),{mode:0o600});fs.renameSync(credentialFile+'.tmp',credentialFile);return status();
    },
    clearCredential(){if(active)throw Error('任务执行中，完成后再清除邮箱配置。');if(fs.existsSync(credentialFile))fs.unlinkSync(credentialFile);data.plan=null;persist();return status();},
    async verify(accountId){const c=decrypt();if(c.accountId!==accountId)throw Error('邮箱配置属于其他 GitHub 账户。');const t=transport(c);try{await t.verify();return{success:true};}finally{t.close();}},
    configure(plan){if(plan&&(!/^\d+$/.test(plan.accountId)||typeof plan.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.time)))throw Error('定时配置无效。');if(active?.status==='generating'&&plan?.accountId!==active.accountId){active.status='interrupted';active=null;}data.plan=plan;persist();return status();},
    due(){const p=data.plan;if(active||!p?.enabled||beijingMinute(now())<p.time||data.runs.some(r=>r.accountId===p.accountId&&r.kind==='scheduled'&&r.date===beijingDay(now())))return null;try{if(decrypt().accountId!==p.accountId)return null;}catch{return null;}const run=addRun(p.accountId,'scheduled');active=run;return{requestId:run.id,accountId:run.accountId};},
    generationFailed(requestId,message){if(active?.id!==requestId||active.status!=='generating')return;active.status='failed';active.error=typeof message==='string'?message.slice(0,200):'生成失败';active=null;persist();},
    async send({accountId,requestId,html,snapshotId,warnings=[]}){
      if(!/^\d+$/.test(accountId)||typeof html!=='string'||!html.startsWith('<!doctype html>')||Buffer.byteLength(html)>15*1024*1024||!/^[-\w]{1,100}$/.test(snapshotId))throw Error('HTML 载荷无效或超过 15 MB。');
      const c=decrypt();if(c.accountId!==accountId)throw Error('邮箱配置属于其他 GitHub 账户。');
      if(requestId){if(!active||active.id!==requestId||active.status!=='generating'||active.accountId!==accountId||data.plan?.accountId!==accountId)throw Error('日报任务已过期、已发送或账户已变化。');}
      else {if(active)throw Error('已有日报任务执行中。');active=addRun(accountId,'manual');}
      const run=active;const filename=`GSM-${run.date}-${run.id}.html`;run.snapshotId=snapshotId;
      let t;
      try{
        fs.writeFileSync(path.join(root,filename)+'.tmp',html,{encoding:'utf8',mode:0o600});fs.renameSync(path.join(root,filename)+'.tmp',path.join(root,filename));
        t=transport(c);run.status='sending';persist();
        const info=await t.sendMail({from:c.from,to:c.to,subject:`GSM 每日项目阅读 · ${run.date}`,messageId:`<gsm-${run.id}@gsm.local>`,text:`北京时间 ${run.date} 的仓库与发现阅读文件已生成。请下载 HTML 后用浏览器打开；邮箱预览可能不支持交互。阅读后导出修改并在桌面设置的“每日 HTML”中导入。\n${Array.isArray(warnings)?warnings.filter(x=>typeof x==='string').slice(0,20).join('\n'):''}`,attachments:[{filename:`GSM-每日阅读-${run.date}.html`,content:html,contentType:'text/html; charset=utf-8'}],disableFileAccess:true,disableUrlAccess:true});if(!info.accepted?.length)throw Error('NO_RECIPIENT_ACCEPTED');run.status='sent';run.completedAt=now().toISOString();
      }
      catch(error){run.status=run.status==='generating'||['EAUTH','EENVELOPE'].includes(error?.code)?'failed':'unconfirmed';run.error=run.status==='failed'?'生成文件或 Gmail 认证失败，请检查磁盘、邮箱配置与网络。':'发送结果未确认，请先检查收件箱；不会自动重复发送。';}
      finally{t?.close();active=null;persist();}
      return{success:run.status==='sent',status:run.status,error:run.error};
    },
  };
}
function registerHtmlReadingIpc({ipcMain,isMainFrame,service,getWindow,powerMonitor}) {
  const safe=fn=>async(event,...args)=>{if(!isMainFrame(event))throw Error('HTML_IPC_DENIED');try{return await fn(...args);}catch{return{success:false,error:'操作失败，请检查账户、邮箱配置、网络或当前任务状态。'};}};
  ipcMain.handle('html-reading:status',safe(()=>service.status()));
  ipcMain.handle('html-reading:saveMail',safe(input=>service.saveCredential(input)));
  ipcMain.handle('html-reading:clearMail',safe(()=>service.clearCredential()));
  ipcMain.handle('html-reading:verify',safe(account=>service.verify(account)));
  ipcMain.handle('html-reading:configure',safe(plan=>service.configure(plan)));
  ipcMain.handle('html-reading:send',safe(input=>service.send(input)));
  ipcMain.handle('html-reading:failed',safe((id,message)=>service.generationFailed(id,message)));
  const tick=()=>{const window=getWindow();if(!window||window.isDestroyed()||window.webContents.isLoadingMainFrame())return;const due=service.due();if(due){window.webContents.send('html-reading:generate',due);setTimeout(()=>service.generationFailed(due.requestId,'桌面未在时限内完成生成，请手动重试。'),180000).unref();}};
  const timer=setInterval(tick,15000);timer.unref();powerMonitor.on('resume',tick);
  return()=>{clearInterval(timer);powerMonitor.removeListener('resume',tick);};
}
module.exports={createHtmlReadingService,registerHtmlReadingIpc,beijingDay,beijingMinute};
