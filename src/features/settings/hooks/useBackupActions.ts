
import { useT } from '../../../i18n/useT';
import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AIConfig, WebDAVConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { WebDAVService } from '../../../services/webdavService';
import { incomingOrganizationSnapshot } from '../../../store/helpers/repositoryOrganization';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { exportDiscoveryWorkspaceBackup, importDiscoveryWorkspaceBackup, validateDiscoveryWorkspaceBackup } from '../../../services/discoveryWorkspaceBackup';

export interface BackupActions {
  activeConfig: WebDAVConfig | undefined;
  isBackingUp: boolean;
  isRestoring: boolean;
  backup: () => Promise<void>;
  restore: () => Promise<void>;
}

/**
 * Owns WebDAV backup and restore orchestration. The payload deliberately keeps
 * the existing key-masking rules, including proxy password and RPC secret.
 */
export const useBackupActions = (): BackupActions => {
  const t = useT('settings');
  const state = useAppStore(useShallow((store) => ({
    user: store.user,
    repositories: store.repositories,
    releases: store.releases,
    customCategories: store.customCategories,
    hiddenDefaultCategoryIds: store.hiddenDefaultCategoryIds,
    aiConfigs: store.aiConfigs,
    webdavConfigs: store.webdavConfigs,
    activeWebDAVConfig: store.activeWebDAVConfig,
    proxyConfig: store.proxyConfig,
    rpcDownloadConfig: store.rpcDownloadConfig,
    routeMode: store.routeMode,
    backendApiSecret: store.backendApiSecret,
    includeKeysInBackup: store.includeKeysInBackup,
    setLastBackup: store.setLastBackup,
    setRepositories: store.setRepositories,
    setReleases: store.setReleases,
    addCustomCategory: store.addCustomCategory,
    deleteCustomCategory: store.deleteCustomCategory,
    hideDefaultCategory: store.hideDefaultCategory,
    showDefaultCategory: store.showDefaultCategory,
    addAIConfig: store.addAIConfig,
    updateAIConfig: store.updateAIConfig,
    deleteAIConfig: store.deleteAIConfig,
    addWebDAVConfig: store.addWebDAVConfig,
    updateWebDAVConfig: store.updateWebDAVConfig,
    deleteWebDAVConfig: store.deleteWebDAVConfig,
    setProxyConfig: store.setProxyConfig,
    setRpcDownloadConfig: store.setRpcDownloadConfig,
    setRouteMode: store.setRouteMode,
    setBackendApiSecret: store.setBackendApiSecret,
    setReleaseSourceSettings: store.setReleaseSourceSettings,
  })));
  const { toast, confirm } = useDialog();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const activeConfig = useMemo(
    () => state.webdavConfigs.find((config) => config.id === state.activeWebDAVConfig),
    [state.activeWebDAVConfig, state.webdavConfigs],
  );

  const backup = useCallback(async () => {
    if (!activeConfig) {
      toast(t('useBackupActions.please-configure-and-activate-webdav-service-fir'), 'error');
      return;
    }
    setIsBackingUp(true);
    const task = aiTaskJournal.begin(String(useAppStore.getState().user?.id ?? ''), 'backup', [{ id: 'backup', label: activeConfig.name }], undefined, undefined, { target: { view: 'settings', tab: 'backup' } });
    task.item('backup', 'running');
    try {
      const account = String(state.user?.id ?? '');
      if (String(useAppStore.getState().user?.id ?? '') !== account) throw new Error('DISCOVERY_BACKUP_ACCOUNT_CHANGED');
      const backupData = {
        ...(account ? { discoveryWorkspace: await exportDiscoveryWorkspaceBackup(account) } : {}),
        repositories: state.repositories,
        releases: state.releases,
        customCategories: state.customCategories,
        subcategories: useAppStore.getState().subcategories,
        subcategoryOrder: useAppStore.getState().subcategoryOrder,
        repositoryOrder: useAppStore.getState().repositoryOrder,
        categoryOrder: useAppStore.getState().categoryOrder,
        defaultCategoryOverrides: useAppStore.getState().defaultCategoryOverrides,
        hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
        aiConfigs: state.aiConfigs.map(config => backupAIConfig(config, state.includeKeysInBackup)),
        webdavConfigs: state.webdavConfigs.map((config) => ({
          ...config,
          password: state.includeKeysInBackup ? config.password : (config.password ? '***' : ''),
        })),
        proxyConfig: {
          ...state.proxyConfig,
          password: state.includeKeysInBackup ? state.proxyConfig.password : (state.proxyConfig.password ? '***' : ''),
        },
        rpcDownloadConfig: {
          ...state.rpcDownloadConfig,
          secret: state.includeKeysInBackup ? state.rpcDownloadConfig.secret : (state.rpcDownloadConfig.secret ? '***' : ''),
        },
        routeMode: state.routeMode,
        backendApiSecret: state.includeKeysInBackup ? state.backendApiSecret : (state.backendApiSecret ? '***' : null),
        releaseSubscriptions: Array.from(useAppStore.getState().releaseSubscriptions),
        releaseSourceSettings: useAppStore.getState().releaseSourceSettings,
        readReleases: Array.from(useAppStore.getState().readReleases),
        includeKeysInBackup: state.includeKeysInBackup,
        exportedAt: new Date().toISOString(),
        version: '1.2',
      };
      if (String(useAppStore.getState().user?.id ?? '') !== account) throw new Error('DISCOVERY_BACKUP_ACCOUNT_CHANGED');
      const filename = `github-stars-backup-${new Date().toISOString().split('T')[0]}.json`;
      const success = await new WebDAVService(activeConfig).uploadFile(filename, JSON.stringify(backupData, null, 2));
      if (success) {
        task.item('backup', 'complete');
        state.setLastBackup(new Date().toISOString());
        toast(t('useBackupActions.data-backup-successful'), 'success');
      } else {
        task.item('backup', 'failed', 'WebDAV upload failed');
        console.error('Backup failed: uploadFile returned falsy');
        toast(t('useBackupActions.data-backup-failed'), 'error');
      }
    } catch (error) {
      task.item('backup', 'failed', error);
      console.error('Backup failed:', error);
      toast(`${t('useBackupActions.backup-failed')}: ${(error as Error).message}`, 'error');
    } finally {
      task.finish();
      setIsBackingUp(false);
    }
  }, [activeConfig, state, t, toast]);

  const restore = useCallback(async () => {
    if (!activeConfig) {
      toast(t('useBackupActions.please-configure-and-activate-webdav-service-fir'), 'error');
      return;
    }
    const confirmed = await confirm(
      t('useBackupActions.restore-data'),
      t('useBackupActions.restoring-data-will-overwrite-all-current-data-c'),
      { type: 'warning' },
    );
    if (!confirmed) return;

    setIsRestoring(true);
    const restoreAccount = String(useAppStore.getState().user?.id ?? '');
    const task = aiTaskJournal.begin(String(useAppStore.getState().user?.id ?? ''), 'restore', [{ id: 'restore', label: activeConfig.name }], undefined, undefined, { target: { view: 'settings', tab: 'backup' } });
    task.item('restore', 'running');
    let restoreWarnings = 0;
    try {
      const service = new WebDAVService(activeConfig);
      const files = await service.listFiles();
      const backupFiles = files.filter((file) => file.startsWith('github-stars-backup-'));
      if (backupFiles.length === 0) {
        task.item('restore', 'failed', 'No backup files found');
        toast(t('useBackupActions.no-backup-files-found'), 'error');
        return;
      }
      const content = await service.downloadFile(backupFiles.sort().reverse()[0]);
      if (!content) {
        task.item('restore', 'failed', 'Backup file is empty');
        toast(t('useBackupActions.backup-file-is-empty-cannot-restore'), 'error');
        return;
      }
      const backupData = JSON.parse(content) as Record<string, unknown>;
      const account = restoreAccount;
      if (String(useAppStore.getState().user?.id ?? '') !== account) throw new Error('DISCOVERY_BACKUP_ACCOUNT_CHANGED');
      validateDiscoveryWorkspaceBackup(account, backupData.discoveryWorkspace);
      await importDiscoveryWorkspaceBackup(account, backupData.discoveryWorkspace, 'replace');
      if (String(useAppStore.getState().user?.id ?? '') !== account) throw new Error('DISCOVERY_BACKUP_ACCOUNT_CHANGED');
      task.state('committing');
      const backupIncludedKeys = backupData.includeKeysInBackup ?? true;
      useAppStore.setState(current => incomingOrganizationSnapshot(current, backupData,
        Array.isArray(backupData.repositories) ? backupData.repositories as typeof current.repositories : undefined));
      if (Array.isArray(backupData.releases)) state.setReleases(backupData.releases as typeof state.releases, { allowEmpty: true });

      try {
        if (Array.isArray(backupData.releaseSubscriptions)) {
          const values = backupData.releaseSubscriptions.filter((id): id is number => typeof id === 'number');
          useAppStore.setState({ releaseSubscriptions: new Set(values) });
        }
        if (backupData.releaseSourceSettings) state.setReleaseSourceSettings(backupData.releaseSourceSettings as Parameters<typeof state.setReleaseSourceSettings>[0]);
        if (Array.isArray(backupData.readReleases)) {
          const values = backupData.readReleases.filter((id): id is number => typeof id === 'number');
          useAppStore.setState({ readReleases: new Set(values) });
        }
      } catch (error) {
        restoreWarnings++; task.error(error);
        console.warn('恢复 Release 订阅与已读状态时发生问题：', error);
      }

      try {
        if (Array.isArray(backupData.aiConfigs)) {
          const currentMap = new Map(useAppStore.getState().aiConfigs.map((config: AIConfig) => [config.id, config]));
          const backupConfigs = backupData.aiConfigs as AIConfig[];
          const restored = restoreAIConfigs([...currentMap.values()], backupConfigs.filter(config => config?.id), !!backupIncludedKeys);
          const current = useAppStore.getState();
          current.setAIConfigs(restored);
          if (!restored.some(config => config.id === current.activeAIConfig)) current.setActiveAIConfig(null);
          if (!restored.some(config => config.id === current.repositoryChatSettings.chatConfigId)) current.setRepositoryChatSettings({ chatConfigId: null });
        }
      } catch (error) {
        restoreWarnings++; task.error(error);
        console.warn('恢复 AI 配置时发生问题：', error);
      }

      try {
        if (Array.isArray(backupData.webdavConfigs)) {
          const currentMap = new Map(useAppStore.getState().webdavConfigs.map((config: WebDAVConfig) => [config.id, config]));
          const backupConfigs = backupData.webdavConfigs as WebDAVConfig[];
          const backupIds = new Set(backupConfigs.map((config) => config?.id).filter(Boolean));
          for (const [id] of currentMap) if (!backupIds.has(id)) state.deleteWebDAVConfig(id);
          for (const config of backupConfigs) {
            if (!config?.id) continue;
            const existing = currentMap.get(config.id);
            const password = backupIncludedKeys && config.password && config.password !== '***' ? config.password : existing?.password ?? '';
            if (existing) {
              state.updateWebDAVConfig(config.id, { ...config, password, isActive: existing.isActive });
            } else {
              state.addWebDAVConfig({ ...config, password, isActive: false });
            }
          }
        }
      } catch (error) {
        restoreWarnings++; task.error(error);
        console.warn('恢复 WebDAV 配置时发生问题：', error);
      }

      try {
        if (backupData.proxyConfig && typeof backupData.proxyConfig === 'object') {
          const backupConfig = backupData.proxyConfig as typeof state.proxyConfig;
          state.setProxyConfig({
            ...backupConfig,
            password: backupIncludedKeys && backupConfig.password && backupConfig.password !== '***' ? backupConfig.password : useAppStore.getState().proxyConfig.password,
          });
        }
      } catch (error) {
        restoreWarnings++; task.error(error);
        console.warn('恢复代理配置时发生问题：', error);
      }
      try {
        if (backupData.rpcDownloadConfig && typeof backupData.rpcDownloadConfig === 'object') {
          const backupConfig = backupData.rpcDownloadConfig as typeof state.rpcDownloadConfig;
          state.setRpcDownloadConfig({
            ...backupConfig,
            secret: backupIncludedKeys && backupConfig.secret && backupConfig.secret !== '***' ? backupConfig.secret : useAppStore.getState().rpcDownloadConfig.secret,
          });
        }
      } catch (error) {
        restoreWarnings++; task.error(error);
        console.warn('恢复远程下载配置时发生问题：', error);
      }
      // routeMode 是本地偏好：仅接受合法枚举，缺失/非法回退 auto（随 1.2 备份导出）
      try {
        const restored = backupData.routeMode;
        const next: 'auto' | 'backend' | 'browser' = restored === 'backend' || restored === 'browser' || restored === 'auto'
          ? restored
          : 'auto';
        if (useAppStore.getState().routeMode !== next) {
          useAppStore.getState().setRouteMode(next);
        }
      } catch (error) {
        restoreWarnings++; task.error(error);
        console.warn('恢复网络路由偏好时发生问题：', error);
      }
      try {
        if (backupIncludedKeys && backupData.backendApiSecret !== undefined && backupData.backendApiSecret !== '***') {
          state.setBackendApiSecret(typeof backupData.backendApiSecret === 'string' ? backupData.backendApiSecret : null);
        }
      } catch (error) {
        restoreWarnings++; task.error(error);
        console.warn('恢复后端 API 密钥时发生问题：', error);
      }
      task.item('restore', 'complete');
      if (restoreWarnings) task.finish('partial');
      toast(t('useBackupActions.data-restored-from-backup-repositories-v1-releas', { v1: (backupData.repositories as unknown[] | undefined)?.length ?? 0, v2: (backupData.releases as unknown[] | undefined)?.length ?? 0, v3: (backupData.customCategories as unknown[] | undefined)?.length ?? 0 }), 'success');
    } catch (error) {
      task.item('restore', 'failed', error);
      console.error('Restore failed:', error);
      toast(`${t('useBackupActions.restore-failed')}: ${(error as Error).message}`, 'error');
    } finally {
      task.finish();
      setIsRestoring(false);
    }
  }, [activeConfig, confirm, state, t, toast]);

  return { activeConfig, isBackingUp, isRestoring, backup, restore };
};
import { backupAIConfig, restoreAIConfigs } from '../../../utils/aiConfig';
