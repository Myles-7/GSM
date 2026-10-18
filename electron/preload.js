const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) contextBridge.exposeInMainWorld('electronAPI', {
  diagnostics: {
    append: payload => ipcRenderer.invoke('diagnostics:append', payload),
    flush: payload => ipcRenderer.send('diagnostics:flush', payload),
    getLogs: filters => ipcRenderer.invoke('diagnostics:getLogs', filters),
    getSystemInfo: () => ipcRenderer.invoke('diagnostics:getSystemInfo'),
    exportBundle: filters => ipcRenderer.invoke('diagnostics:exportBundle', filters),
  },
  htmlReading: {
    status: () => ipcRenderer.invoke('html-reading:status'),
    saveMail: input => ipcRenderer.invoke('html-reading:saveMail', input),
    clearMail: () => ipcRenderer.invoke('html-reading:clearMail'),
    verify: account => ipcRenderer.invoke('html-reading:verify', account),
    configure: plan => ipcRenderer.invoke('html-reading:configure', plan),
    send: input => ipcRenderer.invoke('html-reading:send', input),
    failed: (id, message, reason) => ipcRenderer.invoke('html-reading:failed', id, message, reason),
    progress: (id, message) => ipcRenderer.invoke('html-reading:progress', id, message),
    baseline: account => ipcRenderer.invoke('html-reading:baseline', account),
    resend: (account, id, confirmed) => ipcRenderer.invoke('html-reading:resend', account, id, confirmed),
    cleanup: () => ipcRenderer.invoke('html-reading:cleanup'),
    preview: html => ipcRenderer.invoke('html-reading:preview', html),
    onGenerate: listener => { const handler = (_event, request) => listener(request); ipcRenderer.on('html-reading:generate', handler); return () => ipcRenderer.removeListener('html-reading:generate', handler); },
  },
  agy: {
    chooseProject: requestId => ipcRenderer.invoke('agy:chooseProject', requestId),
    readProject: (requestId, grantId, relative) => ipcRenderer.invoke('agy:readProject', requestId, grantId, relative),
    revokeProject: grantId => ipcRenderer.invoke('agy:revokeProject', grantId),
    getState: () => ipcRenderer.invoke('agy:getState'),
    detect: (requestId) => ipcRenderer.invoke('agy:detect', requestId),
    recover: (requestId) => ipcRenderer.invoke('agy:recover', requestId),
    choose: (requestId) => ipcRenderer.invoke('agy:choose', requestId),
    save: (requestId, prefs) => ipcRenderer.invoke('agy:save', requestId, prefs),
    listModels: (requestId) => ipcRenderer.invoke('agy:listModels', requestId),
    probe: (requestId, feature) => ipcRenderer.invoke('agy:probe', requestId, feature),
    cancel: (requestId) => ipcRenderer.invoke('agy:cancel', requestId),
    setSession: (session, account) => ipcRenderer.invoke('agy:setSession', session, account),
    recoveryList: (session, cursor, limit) => ipcRenderer.invoke('agy:recoveryList', session, cursor, limit),
    recoveryRead: (session, requestId) => ipcRenderer.invoke('agy:recoveryRead', session, requestId),
    recoveryAck: (session, requestId, digest) => ipcRenderer.invoke('agy:recoveryAck', session, requestId, digest),
    recoveryStage: (session, requestId, digest, commit) => ipcRenderer.invoke('agy:recoveryStage', session, requestId, digest, commit),
    recoveryDiscard: (session, requestId) => ipcRenderer.invoke('agy:recoveryDiscard', session, requestId),
    recoveryRepair: (session, requestId, action) => ipcRenderer.invoke('agy:recoveryRepair', session, requestId, action),
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
    onOrganizationRequest: listener => {
      const handler = (_event, request) => listener(request);
      ipcRenderer.on('mcp:organization-request', handler);
      return () => ipcRenderer.removeListener('mcp:organization-request', handler);
    },
    replyOrganization: (requestId, result) => ipcRenderer.invoke('mcp:organization-reply', requestId, result),
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
     // Backend/control bridge is ready for Stage 3 UI; no Marketplace UI is
     // enabled in this stage.
     marketplace: {
       getState: () => ipcRenderer.invoke('plugins:marketplace:getState'),
       addSource: (input) => ipcRenderer.invoke('plugins:marketplace:addSource', input),
       updateSource: (input) => ipcRenderer.invoke('plugins:marketplace:updateSource', input),
       removeSource: (input) => ipcRenderer.invoke('plugins:marketplace:removeSource', input),
       refresh: (options) => ipcRenderer.invoke('plugins:marketplace:refresh', options),
       install: (request) => ipcRenderer.invoke('plugins:marketplace:install', request),
     },
    // 社区插件注册表（开发守则 §17）：只读校验过的注册表，不含安装动作
    registry: {
      load: () => ipcRenderer.invoke('plugins:loadRegistry'),
    },
  },
});
