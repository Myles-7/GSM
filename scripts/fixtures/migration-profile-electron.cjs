// Contained real-main entry. All profile mutations stay in an explicit copied profile.
const {app,BrowserWindow,session,ipcMain,dialog,shell,net}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const profile=path.resolve(process.env.GSM_MIGRATION_PROFILE || '');
const build=path.resolve(process.env.GSM_MIGRATION_BUILD || '');
const permitted=path.join(root,process.env.GSM_SMOKE_SUITE==='reliability'?'output/reliability/profile-smoke':'output/v086-continuation/app-profile-smoke');
if(!profile.startsWith(permitted+path.sep)||!build.startsWith(permitted+path.sep)||!fs.existsSync(path.join(profile,'IndexedDB')))throw Error('Explicit copied profile and build required');
app.setPath('userData',profile);app.setPath('sessionData',profile);
app.setLoginItemSettings=()=>{};
app.commandLine.appendSwitch('disable-background-networking');
global.migrationContainment={networkBlocked:0,fixtureReads:0,forbidden:[]};
const deny=name=>{global.migrationContainment.forbidden.push(name);throw Error('SMOKE_FORBIDDEN:'+name);};
global.fetch=async(input)=>{
  const url=new URL(String(input)),sha='6a69d60a7486eaea580e0b0e40260f43773b73de';let body;
  if(url.hostname==='api.github.com'&&url.pathname==='/repos/AmintaCCCP/GithubStarsManager/commits/'+sha)body={sha};
  else if(url.hostname==='api.github.com'&&url.pathname==='/repos/AmintaCCCP/GithubStarsManager/contents/examples/plugins'&&url.searchParams.get('ref')===sha)body=['repo-info-card','repo-insights'].map(name=>({name,type:'dir'}));
  else if(url.hostname==='raw.githubusercontent.com'){
    const match=url.pathname.match(new RegExp('^/AmintaCCCP/GithubStarsManager/'+sha+'/examples/plugins/(repo-info-card|repo-insights)/manifest.json$'));
    if(match)body=JSON.parse(fs.readFileSync(path.join(root,'examples/plugins',match[1],'manifest.json')));
  }
  if(body){global.migrationContainment.fixtureReads++;return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});}
  global.migrationContainment.networkBlocked++;throw Error('SMOKE_OFFLINE');
};
require('undici').fetch=global.fetch;
net.fetch=global.fetch;
for(const name of ['http','https']){const mod=require('node:'+name);mod.request=mod.get=()=>deny('node-network');}
require('nodemailer').createTransport=()=>({verify:async()=>deny('mail'),sendMail:async()=>deny('mail'),close(){}});
require('../../electron/agyRuntime').runAgy=async()=>deny('paid-ai');
shell.openExternal=async()=>deny('external-navigation');
const trusted=require('../../electron/trustedRenderer');
const candidate=require('node:url').pathToFileURL(path.join(build,'index.html')).href;
const documentCheck=trusted.isTrustedDocument,frameCheck=trusted.isTrustedMainFrame;
trusted.isTrustedDocument=(value,url,dev)=>documentCheck(value,url?candidate:url,dev);
trusted.isTrustedMainFrame=(event,window,url,dev)=>frameCheck(event,window,url?candidate:url,dev);
const pluginIpc=require('../../electron/plugins/pluginIpc'),createRegistrar=pluginIpc.createPluginIpcRegistrar;
pluginIpc.createPluginIpcRegistrar=options=>createRegistrar({...options,getHostURL:()=>candidate});
const load=BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile=function(file,options){return load.call(this,path.basename(file)==='index.html'?path.join(build,'index.html'):file,options);};
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>handle(name,(...args)=>{
  if(/^(agy:(start|run|submit)|x-fetch|telegram-fetch|webdav-request|mcp:start)/i.test(name))return deny('ipc:'+name);
  return fn(...args);
});
const directories=['repo-info-card','repo-insights'];
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(root,'examples/plugins',directories.shift() || 'repo-info-card')]});
dialog.showSaveDialog=async()=>({canceled:true,filePath:''});
app.whenReady().then(()=>{
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const url=new URL(details.url);
    const allowed=url.protocol==='file:'||url.protocol==='data:'||url.protocol==='blob:'||url.protocol==='plugin-page:';
    if(!allowed)global.migrationContainment.networkBlocked++;
    callback({cancel:!allowed});
  });
});
require('../../electron/main.js');
