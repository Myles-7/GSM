const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { isSafeExternalUrl } = require('./trustedRenderer');

function createReadingPreview({ BrowserWindow, Menu, session, shell, fs, path, tempDirectory }) {
  return async html => {
    if (typeof html !== 'string' || !html.startsWith('<!doctype html>') || Buffer.byteLength(html) > 15 * 1024 * 1024) throw Error('预览内容无效或超过 15 MB。');
    const root = path.resolve(tempDirectory);
    const directory = fs.mkdtempSync(path.join(root, 'gsm-reading-preview-'));
    if (path.dirname(path.resolve(directory)) !== root) throw Error('预览目录无效。');
    const file = path.join(directory, 'reading.html');
    fs.writeFileSync(file, html, { encoding: 'utf8', mode: 0o600 });
    const url = pathToFileURL(file).href;
    const isolated = session.fromPartition('gsm-reading-preview-' + crypto.randomUUID());
    isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('blob:') && !details.url.startsWith('data:') && details.url.split('#')[0] !== url }));
    const window = new BrowserWindow({ width: 410, height: 830, minWidth: 300, minHeight: 440, show: false, title: '每日 HTML 预览 · 标记仅用于预览', webPreferences: { session: isolated, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true } });
    let width = 390, theme = null;
    const applyTheme = value => {
      theme = value;
      if (!window.isDestroyed()) void window.webContents.executeJavaScript(value === 'dark' ? "document.body.dataset.mode='dark'" : "document.body.dataset.mode='light'").catch(() => {});
      refreshMenu();
    };
    const refreshMenu = () => window.setMenu(Menu.buildFromTemplate([
      { label: '内容宽度', submenu: [360,390,430,768,1024].map(value => ({ label: value + 'px', type: 'radio', checked: width === value, click: () => { width=value;window.setContentSize(width,780);refreshMenu(); } })) },
      { label: '明暗', submenu: [{label:'浅色',type:'radio',checked:theme==='light',click:()=>applyTheme('light')},{label:'深色',type:'radio',checked:theme==='dark',click:()=>applyTheme('dark')}] },
      { label: '预览说明', submenu: [{label:'实际生成文件；记录与正式资料隔离',enabled:false},{label:'新窗口不保留上次预览标记',enabled:false}] },
    ]));
    const protect = (event, target) => { if (target.split('#')[0] !== url) event.preventDefault(); };
    window.webContents.on('will-navigate', protect);
    window.webContents.on('will-redirect', protect);
    window.webContents.setWindowOpenHandler(({ url: target }) => { if (isSafeExternalUrl(target) && /^https?:/i.test(target)) void shell.openExternal(target).catch(() => {});return { action: 'deny' }; });
    window.webContents.on('did-finish-load', () => { if(theme)applyTheme(theme); });
    window.once('closed', () => { void isolated.clearStorageData().catch(() => {});try {fs.unlinkSync(file);fs.rmdirSync(directory);}catch{/* OS may still hold the temporary file. */} });
    refreshMenu();window.setContentSize(width,780);
    try { await window.loadURL(url);window.show(); } catch(error) {window.destroy();throw error;}
    return { success: true };
  };
}
module.exports = { createReadingPreview };
