const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) contextBridge.exposeInMainWorld('electronAPI', {
  htmlReading: {
    status: () => ipcRenderer.invoke('html-reading:status'),
    saveMail: input => ipcRenderer.invoke('html-reading:saveMail', input),
    clearMail: () => ipcRenderer.invoke('html-reading:clearMail'),
    verify: account => ipcRenderer.invoke('html-reading:verify', account),
    configure: plan => ipcRenderer.invoke('html-reading:configure', plan),
    send: input => ipcRenderer.invoke('html-reading:send', input),
    failed: (id, message) => ipcRenderer.invoke('html-reading:failed', id, message),
    onGenerate: listener => { const handler = (_event, request) => listener(request); ipcRenderer.on('html-reading:generate', handler); return () => ipcRenderer.removeListener('html-reading:generate', handler); },
  },
  agy: {
    chooseProject: requestId => ipcRenderer.invoke('agy:chooseProject', requestId),
    readProject: (requestId, grantId, relative) => ipcRenderer.invoke('agy:readProject', requestId, grantId, relative),
    revokeProject: grantId => ipcRenderer.invoke('agy:revokeProject', grantId),
    getState: () => ipcRenderer.invoke('agy:getState'),
    detect: (requestId) => ipcRenderer.invoke('agy:detect', requestId),
    choose: (requestId) => ipcRenderer.invoke('agy:choose', requestId),
    save: (requestId, prefs) => ipcRenderer.invoke('agy:save', requestId, prefs),
    listModels: (requestId) => ipcRenderer.invoke('agy:listModels', requestId),
    probe: (requestId, feature) => ipcRenderer.invoke('agy:probe', requestId, feature),
    cancel: (requestId) => ipcRenderer.invoke('agy:cancel', requestId),
    setSession: (session) => ipcRenderer.invoke('agy:setSession', session),
    start: (requestId, session, request) => ipcRenderer.invoke('agy:start', requestId, session, request),
    onEvent: (listener) => {
      const handler = (_event, update) => listener(update);
      ipcRenderer.on('agy:event', handler);
      return () => ipcRenderer.removeListener('agy:event', handler);
    },
  },
  setProxy: (config) => ipcRenderer.invoke('set-proxy', config),
  getProxy: () => ipcRenderer.invoke('get-proxy'),
  testProxy: (config) => ipcRenderer.invoke('test-proxy', config),
  xFetchTimeline: (handle) => ipcRenderer.invoke('x-fetch-timeline', handle),
  xFetchGraphQL: (url, auth) => ipcRenderer.invoke('x-fetch-graphql', url, auth),
  xAuth: {
    save: (auth) => ipcRenderer.invoke('x-auth:save', auth),
    get: () => ipcRenderer.invoke('x-auth:get'),
    clear: () => ipcRenderer.invoke('x-auth:clear'),
  },
  telegramFetchChannel: (channel, before) => ipcRenderer.invoke('telegram-fetch-channel', channel, before),
  webdavRequest: params => ipcRenderer.invoke('webdav-request', params),
  webdavCancel: requestId => ipcRenderer.invoke('webdav-cancel', requestId),
  desktop: {
    getPrefs: () => ipcRenderer.invoke('desktop:getPrefs'),
    setAutoLaunch: (enabled) => ipcRenderer.invoke('desktop:setAutoLaunch', enabled),
    setCloseToTray: (enabled) => ipcRenderer.invoke('desktop:setCloseToTray', enabled),
    setMinimizeToTray: (enabled) => ipcRenderer.invoke('desktop:setMinimizeToTray', enabled),
    show: () => ipcRenderer.invoke('desktop:show'),
  },
  mcp: {
    setConfig: (config) => ipcRenderer.invoke('mcp:setConfig', config),
    getConfig: () => ipcRenderer.invoke('mcp:getConfig'),
    pushSnapshot: (snapshot) => ipcRenderer.invoke('mcp:pushSnapshot', snapshot),
    start: () => ipcRenderer.invoke('mcp:start'),
    stop: () => ipcRenderer.invoke('mcp:stop'),
    getStatus: () => ipcRenderer.invoke('mcp:getStatus'),
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    installFromDirectory: () => ipcRenderer.invoke('plugins:installFromDirectory'),
    enable: (pluginId, grantedPermissions) => ipcRenderer.invoke('plugins:enable', pluginId, grantedPermissions),
    disable: (pluginId) => ipcRenderer.invoke('plugins:disable', pluginId),
    uninstall: (pluginId, removePluginData) => ipcRenderer.invoke('plugins:uninstall', pluginId, removePluginData),
    runAction: (request) => ipcRenderer.invoke('plugins:runAction', request),
    runProcessor: (request) => ipcRenderer.invoke('plugins:runProcessor', request),
    pushSnapshot: (snapshot) => ipcRenderer.invoke('plugins:pushSnapshot', snapshot),
    runReleaseProcessor: (request) => ipcRenderer.invoke('plugins:runReleaseProcessor', request),
    downloadReleaseAsset: (request) => ipcRenderer.invoke('plugins:downloadReleaseAsset', request),
    runExporter: (request) => ipcRenderer.invoke('plugins:runExporter', request),
    getPage: (pluginId, pageId) => ipcRenderer.invoke('plugins:getPage', pluginId, pageId),
    requestPageCapability: (request) => ipcRenderer.invoke('plugins:requestPageCapability', request),
    getSearchEndpoint: () => ipcRenderer.invoke('plugins:getSearchEndpoint'),
    configureWebSearch: (endpoint) => ipcRenderer.invoke('plugins:configureWebSearch', endpoint),
    searchWeb: (request) => ipcRenderer.invoke('plugins:searchWeb', request),
    // 社区插件注册表（开发守则 §17）：只读校验过的注册表，不含安装动作
    registry: {
      load: () => ipcRenderer.invoke('plugins:loadRegistry'),
    },
  },
});
