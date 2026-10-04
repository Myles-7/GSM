



import { useT } from '../i18n/useT';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Settings,
  Globe,
  Bot,
  Cloud,
  Database,
  Server,
  Package,
  Palette,
  X,
  Trash2,
  Wifi,
  ScrollText,
  Layout,
  Search,
  Cable,
  Star,
  Plug,
  FileText,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { isElectron } from '../services/electronProxy';
import { useBackendAvailability } from '../features/settings/hooks/useBackendAvailability';
import { useLocalVectorPendingCount } from '../features/settings/hooks/useLocalVectorPendingCount';
import { AppearancePanel } from './settings/AppearancePanel';
import { VectorPendingBadge } from './settings/VectorPendingBadge';
import {
  GeneralPanel,
  AIConfigPanel,
  WebDAVPanel,
  BackupPanel,
  BackendPanel,
  CategoryPanel,
  DataManagementPanel,
  NetworkPanel,
  DiagnosticLogsPanel,
  MenuManagementPanel,
  StarSyncPanel,
  VectorSearchSettings,
  McpSettingsPanel,
  PluginSettingsPanel,
  HtmlReadingPanel,
} from './settings';

type SettingsTab = 'general' | 'appearance' | 'starSync' | 'ai' | 'webdav' | 'backup' | 'backend' | 'category' | 'menu' | 'data' | 'logs' | 'network' | 'vectorSearch' | 'mcp' | 'plugins' | 'htmlReading';

interface SettingsTabItem {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

interface SettingsPanelProps {
  isOpen?: boolean;
  onClose?: () => void;
  isModal?: boolean;
}

const SETTINGS_GROUPS: Array<{ key: string; ids: SettingsTab[] }> = [
  { key: 'basics', ids: ['general', 'appearance', 'menu'] },
  { key: 'workflows', ids: ['ai', 'starSync', 'category', 'vectorSearch', 'htmlReading'] },
  { key: 'storage', ids: ['backup', 'webdav', 'backend', 'data'] },
  { key: 'advanced', ids: ['network', 'plugins', 'mcp', 'logs'] },
];

// Manual activation: arrows move focus; Enter/Space retain native button activation.
function navigateTabs(event: React.KeyboardEvent<HTMLElement>, vertical = false) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const target = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  if (!target) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const index = tabs.indexOf(target);
  if (index < 0) return;
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else if (event.key === (vertical ? 'ArrowDown' : 'ArrowRight')) next = (index + 1) % tabs.length;
  else if (event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) next = (index - 1 + tabs.length) % tabs.length;
  else return;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function SettingsSearch({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const ux = useT('settings');
  return <div className="relative">
    <Search size={14} className="pointer-events-none absolute left-2.5 top-3 text-muted-foreground" />
    <Input value={query} onChange={event => onChange(event.target.value)} aria-label={ux('settingsUx.searchSettings')} placeholder={ux('settingsUx.searchSettings')} className="h-9 pl-8 pr-8 text-sm" />
    {query && <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-9 w-8" onClick={() => onChange('')} aria-label={ux('settingsUx.clearSearch')}><X size={14} /></Button>}
  </div>;
}

function SettingsNav({ tabs, activeTab, onTabChange }: MobileTabNavProps) {
  const t = useT('app');
  const ux = useT('settings');
  const [query, setQuery] = useState('');
  const visible = tabs.filter(tab => tab.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const focusable = visible.find(tab => tab.id === activeTab)?.id ?? visible[0]?.id;
  return <div className="p-3">
    <div className="mb-4"><SettingsSearch query={query} onChange={setQuery} /></div>
    <nav role="tablist" aria-orientation="vertical" aria-label={t('app:settingsPanel.settings-tabs')} onKeyDown={event => navigateTabs(event, true)}>
      {SETTINGS_GROUPS.map(group => {
        const items = group.ids.flatMap(id => visible.filter(tab => tab.id === id));
        return items.length > 0 && <div key={group.key} className="mb-4 last:mb-0">
          <p className="mb-1 px-2 text-[11px] font-medium tracking-wide text-muted-foreground">{ux(`settingsUx.groups.${group.key}`)}</p>
          {items.map(tab => <Button key={tab.id} type="button" variant={activeTab === tab.id ? 'secondary' : 'ghost'} onClick={() => onTabChange(tab.id)}
            role="tab" id={`settings-tab-${tab.id}`} aria-selected={activeTab === tab.id} aria-controls={`settings-tabpanel-${tab.id}`}
            tabIndex={tab.id === focusable ? 0 : -1}
            className="h-9 w-full justify-start gap-2.5 px-2 text-left text-sm">
            {tab.icon}<span className="min-w-0 flex-1 whitespace-normal font-medium">{tab.label}</span>
            {tab.badge != null && <VectorPendingBadge count={tab.badge} t={t} />}
          </Button>)}
        </div>;
      })}
    </nav>
    {visible.length === 0 && <p role="status" className="px-2 py-3 text-sm text-muted-foreground">{ux('settingsUx.noResults')}</p>}
  </div>;
}

// 移动端标签导航组件
interface MobileTabNavProps {
  tabs: SettingsTabItem[];
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

const MobileTabNav: React.FC<MobileTabNavProps> = ({ tabs, activeTab, onTabChange }) => {
  const t = useT('app');
  const ux = useT('settings');
  const [query, setQuery] = useState('');
  const activeRef = useRef<HTMLButtonElement>(null);
  const visible = tabs.filter(tab => tab.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const focusable = visible.find(tab => tab.id === activeTab)?.id ?? visible[0]?.id;
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab, query]);

  return <div className="min-w-0 border-b border-border bg-background/95">
    <div className="px-4 pt-3 pb-1 sm:px-6"><SettingsSearch query={query} onChange={setQuery} /></div>
    <div role="tablist" aria-label={t('app:settingsPanel.settings-tabs')} aria-orientation="horizontal"
      onKeyDown={event => navigateTabs(event)}
      className="flex gap-1 overflow-x-auto px-2 py-2 scrollbar-on-scroll">
      {visible.map(tab => <Button key={tab.id} ref={tab.id === activeTab ? activeRef : undefined}
        type="button" variant={activeTab === tab.id ? 'secondary' : 'ghost'} size="sm"
        onClick={() => onTabChange(tab.id)} role="tab" id={`settings-tab-mobile-${tab.id}`}
        aria-selected={activeTab === tab.id} aria-controls={`settings-tabpanel-${tab.id}`}
        tabIndex={tab.id === focusable ? 0 : -1}
        className="min-h-10 shrink-0 rounded-md touch-manipulation">
        <span className="h-4 w-4 shrink-0">{tab.icon}</span>
        <span className="whitespace-nowrap text-sm font-medium">{tab.label}</span>
        {tab.badge != null && <VectorPendingBadge count={tab.badge} t={t} />}
      </Button>)}
    </div>
    {visible.length === 0 && <p role="status" className="px-4 pb-3 text-sm text-muted-foreground">{ux('settingsUx.noResults')}</p>}
  </div>;
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ 
  isOpen = true, 
  onClose,
  isModal = false 
}) => {
  const { setCurrentView } = useAppStore(useShallow((state) => ({
    language: state.language,
    setCurrentView: state.setCurrentView,
  })));
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [displayTab, setDisplayTab] = useState<SettingsTab>('general');

  const t = useT('app');
  const backendAvailable = useBackendAvailability();
  const localVectorPendingCount = useLocalVectorPendingCount();

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setCurrentView('repositories');
    }
  };

  // Switching settings should respond immediately, including rapid repeated clicks.
  const handleTabChange = useCallback((tabId: SettingsTab) => {
    setActiveTab(tabId);
    setDisplayTab(tabId);
  }, []);

  // Valid SettingsTab values for runtime validation
  const VALID_TABS: ReadonlySet<string> = useMemo(
    () => new Set(['general', 'appearance', 'starSync', 'ai', 'webdav', 'backup', 'backend', 'category', 'menu', 'data', 'logs', 'network', 'vectorSearch', 'mcp', 'plugins', 'htmlReading']),
    []
  );

  // Check sessionStorage for a pending tab (set by DebugModeIndicator before
  // the view switch, so it survives the SettingsPanel remount)
  useEffect(() => {
    const stored = sessionStorage.getItem('gsm:pending-settings-tab');
    if (stored && VALID_TABS.has(stored)) {
      sessionStorage.removeItem('gsm:pending-settings-tab');
      // Apply a pre-mount navigation synchronously. In React Strict Mode an
      // animation timer can be cleaned up during the development remount.
      setActiveTab(stored as SettingsTab);
      setDisplayTab(stored as SettingsTab);
    } else if (stored) {
      sessionStorage.removeItem('gsm:pending-settings-tab');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount to read pending tab from sessionStorage

  // Listen for external tab navigation requests (e.g. from DebugModeIndicator)
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const tab = (e as CustomEvent<{ tab: SettingsTab }>).detail?.tab;
      if (!tab || !VALID_TABS.has(tab)) return;
      handleTabChange(tab);
    };
    window.addEventListener('gsm:navigate-to-settings-tab', onNavigate);
    return () => window.removeEventListener('gsm:navigate-to-settings-tab', onNavigate);
  }, [handleTabChange, VALID_TABS]);

  const tabs: SettingsTabItem[] = [
    { id: 'htmlReading', label: '每日 HTML', icon: <FileText className="w-5 h-5" /> },
    {
      id: 'general',
      label: t('app:settingsPanel.general'),
      icon: <Globe className="w-5 h-5" />,
    },
    {
      id: 'appearance',
      label: t('app:settingsPanel.appearance', { defaultValue: 'Appearance' }),
      icon: <Palette className="w-5 h-5" />,
    },
    {
      id: 'starSync',
      label: t('app:settingsPanel.star-sync'),
      icon: <Star className="w-5 h-5" />,
    },
    {
      id: 'ai',
      label: t('app:settingsPanel.ai-config'),
      icon: <Bot className="w-5 h-5" />,
    },
    {
      id: 'webdav',
      label: t('app:settingsPanel.webdav'),
      icon: <Cloud className="w-5 h-5" />,
    },
    {
      id: 'backup',
      label: t('app:settingsPanel.backup'),
      icon: <Database className="w-5 h-5" />,
    },
    {
      id: 'backend',
      label: t('app:settingsPanel.backend'),
      icon: <Server className="w-5 h-5" />,
    },
    {
      id: 'category',
      label: t('app:settingsPanel.categories'),
      icon: <Package className="w-5 h-5" />,
    },
    {
      id: 'menu',
      label: t('app:settingsPanel.menu'),
      icon: <Layout className="w-5 h-5" />,
    },
    {
      id: 'data',
      label: t('app:settingsPanel.data-management'),
      icon: <Trash2 className="w-5 h-5" />,
    },
    {
      id: 'logs',
      label: t('app:settingsPanel.diagnostic-logs'),
      icon: <ScrollText className="w-5 h-5" />,
    },
    ...((isElectron() || backendAvailable) ? [{
      id: 'network' as SettingsTab,
      label: t('app:settingsPanel.network'),
      icon: <Wifi className="w-5 h-5" />,
    }] : []),
    ...(isElectron() ? [{
      id: 'plugins' as SettingsTab,
      label: t('app:settingsPanel.plugin-management', { defaultValue: 'Plugin Management' }),
      icon: <Plug className="w-5 h-5" />,
    }] : []),
    {
      id: 'vectorSearch' as SettingsTab,
      label: t('app:settingsPanel.vector-search'),
      icon: <Search className="w-5 h-5" />,
      badge: localVectorPendingCount,
    },
    // MCP requires a long-lived process: backend or Electron main. Hide for pure SPA.
    ...((isElectron() || backendAvailable) ? [{
      id: 'mcp' as SettingsTab,
      label: t('app:settingsPanel.mcp-server'),
      icon: <Cable className="w-5 h-5" />,
    }] : []),
  ];

  tabs.sort((a, b) => {
    const order = SETTINGS_GROUPS.flatMap(group => group.ids);
    return order.indexOf(a.id) - order.indexOf(b.id);
  });

  const renderTabContent = () => {
    const content = (() => {
      switch (displayTab) {
        case 'htmlReading':
          return <HtmlReadingPanel />;
        case 'general':
          return <GeneralPanel t={t} />;
        case 'appearance':
          return <AppearancePanel t={t} />;
        case 'starSync':
          return <StarSyncPanel t={t} />;
        case 'ai':
          return <AIConfigPanel t={t} />;
        case 'webdav':
          return <WebDAVPanel t={t} />;
        case 'backup':
          return <BackupPanel t={t} />;
        case 'backend':
          return <BackendPanel t={t} />;
        case 'category':
          return <CategoryPanel t={t} />;
        case 'menu':
          return <MenuManagementPanel t={t} />;
        case 'data':
          return <DataManagementPanel t={t} />;
        case 'logs':
          return <DiagnosticLogsPanel t={t} />;
        case 'network':
          return <NetworkPanel t={t} />;
        case 'vectorSearch':
          return <VectorSearchSettings t={t} />;
        case 'mcp':
          return <McpSettingsPanel t={t} />;
        case 'plugins':
          return <PluginSettingsPanel t={t} />;
        default:
          return null;
      }
    })();

    return (
      <div
        role="tabpanel"
        id={`settings-tabpanel-${displayTab}`}
        aria-label={tabs.find((tab) => tab.id === displayTab)?.label ?? t('app:settingsPanel.settings-content')}
        tabIndex={0}
        className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {content}
      </div>
    );
  };

  if (!isOpen && !isModal) return null;

  // 模态框模式
  if (isModal) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent showClose={false} aria-labelledby="settings-modal-title" aria-describedby={undefined} className="h-[85vh] max-w-5xl overflow-hidden p-0">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b ui-divider bg-background px-5 py-4 dark:bg-card sm:px-6">
              <div className="flex items-center space-x-3">
                <Settings className="h-6 w-6 text-muted-foreground dark:text-muted-foreground" />
                <DialogTitle id="settings-modal-title" className="text-xl font-semibold text-foreground dark:text-foreground">
                  {t('app:settingsPanel.settings')}
                </DialogTitle>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={handleClose} aria-label={t('app:settingsPanel.close-settings')}>
                <X className="h-5 w-5 text-muted-foreground dark:text-muted-foreground" />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
              <div className="hidden w-56 shrink-0 overflow-y-auto border-r ui-divider bg-background dark:bg-card md:block">
                <SettingsNav tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />
              </div>

              <div className="md:hidden">
                <MobileTabNav tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <div className="mx-auto max-w-3xl">{renderTabContent()}</div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // 独立页面模式（兼容原有代码）
  return (
    <div className="mx-auto min-w-0 max-w-6xl">
      <div className="flex items-center space-x-3 mb-6">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t('app:settingsPanel.settings')}
        </h2>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* 桌面端侧边栏 */}
        <div className="hidden lg:block w-56 flex-shrink-0 lg:sticky lg:top-4 lg:self-start max-h-[calc(100vh-6rem)] overflow-y-auto">
          <div className="ui-panel overflow-hidden rounded-md">
            <SettingsNav tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />
          </div>
        </div>

        {/* 移动端标签导航 */}
        <div className="lg:hidden -mx-4 sm:-mx-6">
          <MobileTabNav
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        </div>

        {/* 内容区域 */}
        <div className="flex-1 min-w-0">
          <div className="ui-panel min-w-0 rounded-xl p-4 sm:p-6">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
