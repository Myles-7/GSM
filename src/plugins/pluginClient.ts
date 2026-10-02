import type {
  ElectronPluginAPI,
  PluginListResult,
  PluginOperationResult,
  RunPluginActionRequest,
  RunPluginActionResult,
} from './types';
import { aiTaskJournal } from '../services/aiTaskJournal';
import { useAppStore } from '../store/useAppStore';

async function track<T extends { success: boolean }>(plugin: string, action: string, run: () => Promise<T>): Promise<T> {
  const owner = useAppStore.getState().user?.id;
  const journal = owner === undefined ? null : aiTaskJournal.begin(String(owner), 'plugins', [{ id: action, label: `${plugin}: ${action}` }]);
  journal?.bind({}); // Existing plugin API has no cancellation or safe replay contract.
  journal?.item(action, 'running');
  let invalidated = false;
  const off = useAppStore.subscribe((next, previous) => {
    if (next.user?.id !== previous.user?.id || next.githubToken !== previous.githubToken) invalidated = true;
  });
  try {
    const result = await run();
    if (invalidated) throw new DOMException('Account changed', 'AbortError');
    journal?.item(action, result.success ? 'complete' : 'failed');
    return result;
  } catch (error) { journal?.item(action, 'failed'); throw error; }
  finally { off(); journal?.finish(); }
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
    return api()?.disable(pluginId) ?? unavailable();
  },
  async uninstall(pluginId: string, removePluginData?: boolean): Promise<PluginOperationResult> {
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
  async requestPageCapability(request: Parameters<ElectronPluginAPI['requestPageCapability']>[0]): ReturnType<ElectronPluginAPI['requestPageCapability']> {
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return pluginApi.requestPageCapability(request);
  },
  async getSearchEndpoint(): ReturnType<ElectronPluginAPI['getSearchEndpoint']> {
    return api()?.getSearchEndpoint() ?? { endpoint: null };
  },
  async configureWebSearch(endpoint: string | null): ReturnType<ElectronPluginAPI['configureWebSearch']> {
    return api()?.configureWebSearch(endpoint) ?? unavailable();
  },
  async searchWeb(request: Parameters<ElectronPluginAPI['searchWeb']>[0]): ReturnType<ElectronPluginAPI['searchWeb']> {
    const pluginApi = api();
    if (!pluginApi) return unavailableError();
    return pluginApi.searchWeb(request);
  },
};
