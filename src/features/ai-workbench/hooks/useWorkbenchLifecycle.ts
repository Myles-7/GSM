import { useEffect } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { workbenchRuntime } from '../../../services/aiWorkbenchService';

/** Runtime ownership is independent of whichever view is mounted. */
export function useWorkbenchLifecycle() {
  const user = useAppStore((s) => s.user);
  const token = useAppStore((s) => s.githubToken);
  useEffect(() => {
    const task = workbenchRuntime.getSnapshot();
    if (task.running && task.ownerId !== String(user?.id ?? '')) workbenchRuntime.stop();
    return () => { workbenchRuntime.stop(); };
  }, [user?.id, token]);
  useEffect(() => {
    const stop = () => workbenchRuntime.stop();
    window.addEventListener('pagehide', stop);
    return () => window.removeEventListener('pagehide', stop);
  }, []);
}
