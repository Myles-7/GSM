import type {
  ElectronPluginAPI,
  PluginListResult,
  PluginOperationResult,
  RunPluginActionRequest,
  RunPluginActionResult,
  PluginPageCapabilitySession,
} from './types';
import { aiTaskJournal } from '../services/aiTaskJournal';
import { useAppStore } from '../store/useAppStore';
import { bindTaskSignal, taskConfigSnapshot } from '../services/taskExecution';

function operationError(result: { success: boolean }): string | undefined {
  if (result.success) return undefined;
  const error = 'error' in result ? result.error : undefined;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Plugin returned failure without error details / 插件未提供失败详情';
}

const closedPage = () => ({
  success: false as const, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'Plugin page session expired' },
});

// Page AI is cancellable, unlike Worker actions. Track confirmation and execution together.
async function trackPageAI<T extends { success: boolean }>(
  session: PluginPageCapabilitySession, pluginName: string, signal: AbortSignal,
  isCurrent: () => boolean, run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const state = useAppStore.getState();
  const owner = state.user?.id;
  const controller = new AbortController();
  let rejectAbort: ((error: DOMException) => void) | undefined;
  const abort = () => {
    controller.abort();
    rejectAbort?.(new DOMException('Plugin page closed', 'AbortError'));
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const itemId = `${session.pageId}:${session.requestId}`;
  const journal = owner === undefined ? null : aiTaskJournal.begin(String(owner), 'plugins',
    [{ id: itemId, label: `${pluginName}: ${session.pageId}` }], state.activeAIConfig ?? undefined);
  const config = state.aiConfigs.find(item => item.id === state.activeAIConfig);
  journal?.metadata({ title: pluginName, target: { view: 'settings', tab: 'plugins' }, ...(config ? { config: taskConfigSnapshot(config, 'plugin') } : {}) });
  if (journal) bindTaskSignal(controller.signal, journal);
  journal?.bind({ stop: abort });
  journal?.item(itemId, 'running');
  const off = useAppStore.subscribe((next, previous) => {
    if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) abort();
  });
  try {
    if (controller.signal.aborted || !isCurrent()) throw new DOMException('Plugin page closed', 'AbortError');
    const canceled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const result = await Promise.race([run(controller.signal), canceled]);
    if (controller.signal.aborted || !isCurrent()) throw new DOMException('Plugin page closed', 'AbortError');
    journal?.item(itemId, result.success ? 'complete' : 'failed', operationError(result));
    return result;
  } catch (error) {
    journal?.item(itemId, 'failed', error);
    throw error;
  } finally {
    rejectAbort = undefined;
    off();
    signal.removeEventListener('abort', abort);
    journal?.finish(controller.signal.aborted ? 'canceled' : undefined);
  }
}

async function track<T extends { success: boolean }>(plugin: string, action: string, run: () => Promise<T>): Promise<T> {
  const owner = useAppStore.getState().user?.id;
  const journal = owner === undefined ? null : aiTaskJournal.begin(String(owner), 'plugins', [{ id: action, label: `${plugin}: ${action}` }]);
  journal?.metadata({ title: plugin, target: { view: 'settings', tab: 'plugins' } });
  journal?.bind({}); // Existing plugin API has no cancellation or safe replay contract.
  journal?.item(action, 'running');
  let invalidated = false;
  const off = useAppStore.subscribe((next, previous) => {
    if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) invalidated = true;
  });
  try {
    const result = await run();
    if (invalidated) throw new DOMException('Account changed', 'AbortError');
    journal?.item(action, result.success ? 'complete' : 'failed', operationError(result));
    return result;
  } catch (error) { journal?.item(action, 'failed', error); throw error; }
  finally { off(); journal?.finish(invalidated ? 'canceled' : undefined); }
}

const unavailableError = () => ({
  success: false,
  error: { code: 'PLUGIN_API_UNAVAILABLE', message: 'Plugin API is available only in the desktop app' },
} as const);

const unavailable = (): PluginOperationResult => unavailableError();

const unavailableAction = (): RunPluginActionResult => unavailableError();

function api(): ElectronPluginAPI | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAPI?.plugins;
}

export const pluginClient = {
  trackPageAI,
  isSupported(): boolean {
    return typeof window !== 'undefined' && !!window.electronAPI?.plugins;
  },
  async list(): Promise<PluginListResult> {
    return api()?.list() ?? { plugins: [], invalidPlugins: [] };
  },
  async installFromDirectory(): ReturnType<ElectronPluginAPI['installFromDirectory']> {
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return pluginApi.installFromDirectory();
  },
  async enable(pluginId: string, grantedPermissions: string[]): Promise<PluginOperationResult> {
    return api()?.enable(pluginId, grantedPermissions) ?? unavailable();
  },
  async disable(pluginId: string): Promise<PluginOperationResult> {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('plugin-page:revoke', { detail: pluginId }));
    return api()?.disable(pluginId) ?? unavailable();
  },
  async uninstall(pluginId: string, removePluginData?: boolean): Promise<PluginOperationResult> {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('plugin-page:revoke', { detail: pluginId }));
    return api()?.uninstall(pluginId, removePluginData) ?? unavailable();
  },
  async runAction(request: RunPluginActionRequest): Promise<RunPluginActionResult> {
    return track(request.pluginId, request.actionId, async () => api()?.runAction(request) ?? unavailableAction());
  },
  async runProcessor(request: Parameters<ElectronPluginAPI['runProcessor']>[0]): ReturnType<ElectronPluginAPI['runProcessor']> {
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return track(request.pluginId, request.processorId, () => pluginApi.runProcessor(request));
  },
  async pushSnapshot(snapshot: Parameters<ElectronPluginAPI['pushSnapshot']>[0]): ReturnType<ElectronPluginAPI['pushSnapshot']> {
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return pluginApi.pushSnapshot(snapshot);
  },
  async runReleaseProcessor(request: Parameters<ElectronPluginAPI['runReleaseProcessor']>[0]): ReturnType<ElectronPluginAPI['runReleaseProcessor']> {
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return track(request.pluginId, request.processorId, () => pluginApi.runReleaseProcessor(request));
  },
  async downloadReleaseAsset(request: Parameters<ElectronPluginAPI['downloadReleaseAsset']>[0]): ReturnType<ElectronPluginAPI['downloadReleaseAsset']> {
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return pluginApi.downloadReleaseAsset(request);
  },
  async runExporter(request: Parameters<ElectronPluginAPI['runExporter']>[0]): ReturnType<ElectronPluginAPI['runExporter']> {
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return track(request.pluginId, request.exporterId, () => pluginApi.runExporter(request));
  },
  async getPage(pluginId: string, pageId: string): ReturnType<ElectronPluginAPI['getPage']> {
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return pluginApi.getPage(pluginId, pageId);
  },
  async requestPageCapability(request: Omit<Parameters<ElectronPluginAPI['requestPageCapability']>[0], 'sessionToken' | 'requestId'> &
    Partial<Pick<PluginPageCapabilitySession, 'sessionToken' | 'requestId'>>): ReturnType<ElectronPluginAPI['requestPageCapability']> {
    // Old hooks compile during the selective migration, but cannot use an unbound bridge.
    if (!request.sessionToken || !request.requestId) return closedPage();
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return pluginApi.requestPageCapability(request as Parameters<ElectronPluginAPI['requestPageCapability']>[0]);
  },
  async getSearchEndpoint(): ReturnType<ElectronPluginAPI['getSearchEndpoint']> {
    return api()?.getSearchEndpoint() ?? { endpoint: null };
  },
  async configureWebSearch(endpoint: string | null): ReturnType<ElectronPluginAPI['configureWebSearch']> {
    return api()?.configureWebSearch(endpoint) ?? unavailable();
  },
  async searchWeb(request: Omit<Parameters<ElectronPluginAPI['searchWeb']>[0], 'sessionToken' | 'requestId'> &
    Partial<Pick<PluginPageCapabilitySession, 'sessionToken' | 'requestId'>>): ReturnType<ElectronPluginAPI['searchWeb']> {
    if (!request.sessionToken || !request.requestId) return closedPage();
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return pluginApi.searchWeb(request as Parameters<ElectronPluginAPI['searchWeb']>[0]);
  },
};
