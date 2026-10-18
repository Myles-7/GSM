import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { createLocalMcpToken, codexOrganizationConfig } from '../../../services/mcpClientConfig';
import { refreshMcpElectronBridge } from '../../../services/mcpElectronBridge';

export function useLocalAgentMcp() {
  const { config, setConfig } = useAppStore(useShallow(state => ({ config: state.mcpConfig, setConfig: state.setMcpConfig })));
  const [status, setStatus] = useState<{ running: boolean; url?: string; error?: string }>({ running: false });
  const refresh = useCallback(async () => {
    try { setStatus(await window.electronAPI?.mcp?.getStatus() ?? { running: false }); }
    catch { setStatus({ running: false, error: 'GSM_CONNECTION_FAILED' }); }
  }, []);
  useEffect(() => {
    void refresh(); const timer = setInterval(() => { void refresh(); }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  const toggle = (enabled: boolean) => { setConfig({ enabled, token: config.token || (enabled ? createLocalMcpToken() : '') }); refreshMcpElectronBridge(); };
  const url = `http://127.0.0.1:${config.port}/mcp`;
  return { config, status, url, refresh, toggle, setPort: (port: number) => setConfig({ port }),
    resetToken: () => setConfig({ token: createLocalMcpToken() }), codexConfig: codexOrganizationConfig(url, config.token || '<token>') };
}
