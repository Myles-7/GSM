import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { useAppStore } from '../store/useAppStore';

const schema = z.object({ view: z.string(), id: z.string(), owner: z.string(), kind: z.string().optional() });
export function useTaskTarget(view: string, navigate: (id: string, kind?: string) => void) {
  const callback = useRef(navigate); callback.current = navigate;
  useEffect(() => {
    const consume = () => {
      try {
        const raw = sessionStorage.getItem('gsm:pending-task-target');
        if (!raw) return;
        const parsed = schema.safeParse(JSON.parse(raw));
        if (!parsed.success || parsed.data.owner !== String(useAppStore.getState().user?.id ?? '')) { sessionStorage.removeItem('gsm:pending-task-target'); return; }
        if (parsed.data.view !== view) return;
        sessionStorage.removeItem('gsm:pending-task-target');
        callback.current(parsed.data.id, parsed.data.kind);
      } catch { sessionStorage.removeItem('gsm:pending-task-target'); }
    };
    consume(); window.addEventListener('gsm:task-navigate', consume);
    return () => window.removeEventListener('gsm:task-navigate', consume);
  }, [view]);
}
