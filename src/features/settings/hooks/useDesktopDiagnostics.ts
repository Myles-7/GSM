import { useCallback, useEffect, useState } from 'react';
import type { LogEntry } from '../../../services/logger';
import { sanitizeDiagnosticData } from '../../../utils/logSanitizer';

export function useDesktopDiagnostics() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState(false);
  const api = window.electronAPI?.diagnostics;
  const refresh = useCallback(async () => {
    if (!api?.getLogs) return;
    try { setEntries(sanitizeDiagnosticData(await api.getLogs({ limit: 2000 })) as LogEntry[]); setError(false); }
    catch { setError(true); }
  }, [api]);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!api?.getLogs) return;
      try {
        const logs = sanitizeDiagnosticData(await api.getLogs({ limit: 2000 })) as LogEntry[];
        if (!disposed) { setEntries(logs); setError(false); }
      } catch { if (!disposed) setError(true); }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 10_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [api]);
  return { entries, error, refresh, available: !!api?.getLogs };
}
