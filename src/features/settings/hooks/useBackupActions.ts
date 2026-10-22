
import { useT } from '../../../i18n/useT';
import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { WebDAVConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { WebDAVService } from '../../../services/webdavService';
import { classificationBackupExport } from '../../../store/helpers/classificationSchemes';
import { aiTaskJournal } from '../../../services/aiTaskJournal';
import { exportDiscoveryWorkspaceBackup } from '../../../services/discoveryWorkspaceBackup';
import { decodeCloudBackup, planCloudBackupRestore } from '../../../services/cloudBackupRestore';
import { executeLocalBackupRestore } from '../../../services/localBackupRestore';
import { getLocalBackupIdentity } from '../../../services/localBackupScope';

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
        classificationSchemes: classificationBackupExport(useAppStore.getState()),
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
        identity: getLocalBackupIdentity(false),
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
      const decodedBackup = decodeCloudBackup(content);
      const backupData = decodedBackup.data;
      const identity = getLocalBackupIdentity(true);
      if (String(useAppStore.getState().user?.id ?? '') !== restoreAccount) throw new Error('BACKUP_ACCOUNT_CHANGED');
      const zh = useAppStore.getState().language.startsWith('zh');
      if (!decodedBackup.identity) {
        const legacyConfirmed = await confirm(
          zh ? '确认旧备份身份' : 'Confirm legacy backup identity',
          zh ? '此备份没有账户身份，无法自动核实来源。我确认它属于当前账户并承担覆盖风险。' : 'This backup has no account identity. Its origin cannot be verified. I confirm it belongs to the current account and accept the overwrite risk.',
          { type: 'warning' },
        );
        if (!legacyConfirmed) return;
      }
      const prepared = await planCloudBackupRestore(useAppStore.getState(), decodedBackup, identity, true);
      const accepted = await confirm(t('useBackupActions.restore-data'), prepared.plan.summary, { type: 'warning' });
      if (!accepted) return;
      if (String(useAppStore.getState().user?.id ?? '') !== restoreAccount) throw new Error('BACKUP_ACCOUNT_CHANGED');
      task.state('committing');
      await executeLocalBackupRestore(prepared.plan, { configuration: prepared.configuration, compensateOnFailure: true });
      task.item('restore', 'complete');
      toast(t('useBackupActions.data-restored-from-backup-repositories-v1-releas', { v1: (backupData.repositories as unknown[] | undefined)?.length ?? 0, v2: (backupData.releases as unknown[] | undefined)?.length ?? 0, v3: (backupData.customCategories as unknown[] | undefined)?.length ?? 0 }), 'success');
    } catch (error) {
      task.item('restore', 'failed', error);
      console.error('Restore failed:', error);
      toast(`${t('useBackupActions.restore-failed')}: ${(error as Error).message}`, 'error');
    } finally {
      task.finish();
      setIsRestoring(false);
      window.dispatchEvent(new Event('gsm:local-backup-recovery'));
    }
  }, [activeConfig, confirm, t, toast]);

  return { activeConfig, isBackingUp, isRestoring, backup, restore };
};
import { backupAIConfig } from '../../../utils/aiConfig';
