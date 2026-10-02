import { useCallback } from 'react';
import { UPDATE_POLICY, UpdateService } from '../../../services/updateService';
import type { UpdateCheckResult, VersionInfo } from '../../../services/updateService';

export type { UpdateCheckResult, VersionInfo };

export interface UpdateActions {
  notificationsEnabled: boolean;
  checkUpstreamUpdates: (signal?: AbortSignal) => Promise<UpdateCheckResult>;
  openDownloadUrl: (url: string) => void;
}

export const useUpdateActions = (): UpdateActions => {
  const checkUpstreamUpdates = useCallback((signal?: AbortSignal) => UpdateService.checkUpstreamUpdates(signal), []);
  const openDownloadUrl = useCallback((url: string) => UpdateService.openDownloadUrl(url), []);
  return { notificationsEnabled: UPDATE_POLICY.notifications, checkUpstreamUpdates, openDownloadUrl };
};
