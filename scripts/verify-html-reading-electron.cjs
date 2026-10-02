// Isolated, hidden Electron smoke test. Does not load the user's profile or send mail.
const {app,BrowserWindow,ipcMain,powerMonitor,safeStorage}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'output','html-reading','electron-smoke');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',out);app.setName('GSM HTML Reading Smoke');
const {createHtmlReadingService,registerHtmlReadingIpc}=require('../electron/htmlReading');
let window;
const timer=setTimeout(()=>{process.stderr.write('Electron smoke timed out\n');app.exit(1);},30000);
app.whenReady().then(async()=>{
  const service=createHtmlReadingService({fs,path,userData:out,safeStorage,createTransport:require('nodemailer').createTransport});
  window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(root,'electron','preload.js')}});
  registerHtmlReadingIpc({ipcMain,isMainFrame:event=>event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame,service,getWindow:()=>window,powerMonitor});
  window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
  await window.loadURL('data:text/html,<html><body>Isolated HTML reading test</body></html>');
  const status=await window.webContents.executeJavaScript('window.electronAPI.htmlReading.status()');
  if(status.success===false||!Array.isArray(status.runs))throw Error('Status IPC failed');
  await window.webContents.executeJavaScript('window.electronAPI.htmlReading.configure({accountId:"42",enabled:false,time:"08:00"})');
  const configured=await window.webContents.executeJavaScript('window.electronAPI.htmlReading.status()');
  if(configured.plan?.time!=='08:00'||configured.plan?.enabled!==false)throw Error('Configuration IPC failed');
  await window.webContents.executeJavaScript('window.electronAPI.htmlReading.configure(null)');
  const report={passed:true,preloadAndMainIpc:true,sandboxedRenderer:true,systemEncryptionAvailable:safeStorage.isEncryptionAvailable(),noMailSent:true,noUserProfileAccess:true};
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report)+'\n');clearTimeout(timer);app.exit(0);
}).catch(error=>{process.stderr.write(error.message+'\n');clearTimeout(timer);app.exit(1);});
