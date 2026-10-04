const {test}=require('node:test');const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createReadingPreview}=require('./htmlReadingPreview');
test('preview isolates sessions, has no preload/Node and denies external resources and navigation',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gsm-preview-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const windows=[],partitions=[],sessions=[],external=[];
  class Window extends EventEmitter {constructor(options){super();this.options=options;this.webContents=new EventEmitter();this.webContents.executeJavaScript=async()=>{};this.webContents.setWindowOpenHandler=fn=>this.open=fn;windows.push(this);}setMenu(menu){this.menu=menu;}setContentSize(w,h){this.size=[w,h];}isDestroyed(){return false;}async loadURL(url){this.url=url;}show(){}destroy(){this.emit('closed');}}
  const session={fromPartition:name=>{partitions.push(name);const result={setPermissionRequestHandler:fn=>result.request=fn,setPermissionCheckHandler:fn=>result.check=fn,webRequest:{onBeforeRequest:fn=>result.before=fn},clearStorageData:async()=>{}};sessions.push(result);return result;}};
  const open=createReadingPreview({BrowserWindow:Window,Menu:{buildFromTemplate:x=>x},session,shell:{openExternal:async x=>external.push(x)},fs,path,tempDirectory:root});
  await open('<!doctype html><p>actual</p>');await open('<!doctype html><p>second</p>');const window=windows[0],s=sessions[0];
  assert.notEqual(partitions[0],partitions[1]);assert.ok(!partitions[0].startsWith('persist:'));assert.equal(window.options.webPreferences.nodeIntegration,false);assert.equal(window.options.webPreferences.sandbox,true);assert.ok(!window.options.webPreferences.preload);assert.deepEqual(window.size,[390,780]);
  let cancelled;s.before({url:'https://github.com/anything'},x=>cancelled=x.cancel);assert.equal(cancelled,true);s.before({url:window.url},x=>cancelled=x.cancel);assert.equal(cancelled,false);s.before({url:'file:///C:/secret.txt'},x=>cancelled=x.cancel);assert.equal(cancelled,true);
  let prevented=false;window.webContents.emit('will-navigate',{preventDefault:()=>prevented=true},'https://evil.test');assert.equal(prevented,true);
  assert.equal(window.open({url:'javascript:alert(1)'}).action,'deny');assert.equal(external.length,0);window.open({url:'https://github.com/example/project'});assert.deepEqual(external,['https://github.com/example/project']);
  assert.equal(s.check(),false);let permission;s.request(null,'clipboard-read',value=>permission=value);assert.equal(permission,false);
  window.menu[0].submenu[4].click();assert.deepEqual(window.size,[1024,780]);window.destroy();assert.equal(fs.readdirSync(root).length,1);windows[1].destroy();assert.equal(fs.readdirSync(root).length,0);
});
test('preview rejects invalid documents before creating files/windows',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gsm-preview-invalid-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const open=createReadingPreview({fs,path,tempDirectory:root});await assert.rejects(open('<p>invalid</p>'));assert.equal(fs.readdirSync(root).length,0);
});
