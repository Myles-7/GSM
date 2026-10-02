import { useEffect } from 'react';
import { UPDATE_POLICY } from '../services/updateService';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';

// Retained at startup to clear obsolete upstream notifications, including late hydration.
export const useAutoUpdateCheck = () => {
  const { updateNotification, dismissUpdateNotification } = useAppStore(useShallow((state) => ({
    updateNotification: state.updateNotification,
    dismissUpdateNotification: state.dismissUpdateNotification,
  })));

  useEffect(() => {
    if (!UPDATE_POLICY.automaticChecks && updateNotification) {
      dismissUpdateNotification();
    }
  }, [updateNotification, dismissUpdateNotification]);
};
