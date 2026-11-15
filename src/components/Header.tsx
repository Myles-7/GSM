



import { useT } from '../i18n/useT';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Settings, Calendar, Search, Moon, Sun, LogOut, Compass, GitFork, FileCode2, Menu, X, Bot, MoreHorizontal } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useDialog } from '../hooks/useDialog';
import { HeaderMenuId, AppState } from '../types';
import { PageTranslationButton } from './PageTranslationButton';

const BRAND_NAME = 'GitHub Stars Manager';

const MENU_META: Record<HeaderMenuId, {
  icon: React.ComponentType<{ className?: string }>;
  labelZh: string;
  labelEn: string;
}> = {
  repositories: { icon: Search, labelZh: '仓库', labelEn: 'Repositories' },
  gists: { icon: FileCode2, labelZh: 'Gist', labelEn: 'Gist' },
  releases: { icon: Calendar, labelZh: '发布', labelEn: 'Releases' },
  forks: { icon: GitFork, labelZh: '复刻', labelEn: 'Forks' },
  subscription: { icon: Compass, labelZh: '发现', labelEn: 'Discover' },
  ai: { icon: Bot, labelZh: 'AI', labelEn: 'AI' },
  reading: { icon: FileCode2, labelZh: 'HTML', labelEn: 'HTML' },
  settings: { icon: Settings, labelZh: '设置', labelEn: 'Settings' },
};

export const Header: React.FC<{ taskPanel?: React.ReactNode }> = ({ taskPanel }) => {
  const {
    user,
    theme,
    currentView,
    headerMenuConfig,
    setTheme,
    setCurrentView,
    logout,

  } = useAppStore(useShallow((state) => ({
    user: state.user,
    theme: state.theme,
    currentView: state.currentView,
    headerMenuConfig: state.headerMenuConfig,
    setTheme: state.setTheme,
    setCurrentView: state.setCurrentView,
    logout: state.logout,
    language: state.language,
  })));

  const { confirm } = useDialog();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navigationOverflows, setNavigationOverflows] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const navigationItemsRef = useRef<HTMLDivElement>(null);

  const visibleMenus = useMemo(() =>
    [...headerMenuConfig]
      .filter(item => item.visible)
      .sort((a, b) => a.order - b.order),
    [headerMenuConfig]
  );

  const t = useT('app');

  useEffect(() => {
    const navigation = navigationRef.current;
    const items = navigationItemsRef.current;
    if (!navigation || !items) return;

    // Compare against the entire navigation width so showing the overflow
    // trigger cannot itself keep the trigger visible after the window grows.
    const updateOverflow = () => {
      setNavigationOverflows(navigation.clientWidth > 0 && items.scrollWidth > navigation.clientWidth + 1);
    };
    updateOverflow();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateOverflow);
    observer?.observe(navigation);
    observer?.observe(items);
    window.addEventListener('resize', updateOverflow);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateOverflow);
    };
  }, [visibleMenus, t]);

  return (
    <header className="linear-header sticky top-0 z-50 hd-drag lg:hd-drag relative">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="linear-header-inner flex h-14 items-center justify-between">
          {/* Logo and Title */}
          <div className="flex min-w-0 items-center space-x-3 lg:max-w-[11rem] lg:shrink-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
              <img 
                src="./icon.png" 
                alt={BRAND_NAME}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 title={BRAND_NAME} aria-label={BRAND_NAME} className="truncate text-sm font-semibold tracking-tight text-foreground">
                <span className="lg:hidden">{BRAND_NAME}</span>
                <span className="hidden lg:inline" aria-hidden="true">GitHub Stars</span>
              </h1>
              <p className="truncate text-xs text-muted-foreground lg:hidden">
                AI-powered repository management
              </p>
            </div>
            <div className="min-w-0 sm:hidden">
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                GitHub Stars
              </h1>
            </div>
          </div>

          {/* Navigation - Desktop & Tablet (≥768px) */}
          <nav ref={navigationRef} aria-label={t('header.menu')} className="hidden min-w-0 flex-1 items-center hd-btns md:flex lg:mx-2 lg:hd-btns">
            <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide">
              <div ref={navigationItemsRef} className="mx-auto flex w-max items-center gap-1">
                {visibleMenus.map(menuItem => {
                  const Icon = MENU_META[menuItem.id].icon;
                  const label = t(`header.menu-${menuItem.id}`);
                  const isActive = currentView === menuItem.id;
                  return (
                    <Button
                      key={menuItem.id}
                      type="button"
                      variant={isActive ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setCurrentView(menuItem.id as AppState['currentView'])}
                      aria-pressed={isActive}
                      title={label}
                      aria-label={label}
                      className="whitespace-nowrap lg:px-1.5 xl:px-2"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="hidden lg:inline">{label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
            {navigationOverflows && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t('header.menu')} title={t('header.menu')}>
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-w-[calc(100vw-2rem)]">
                  {visibleMenus.map(menuItem => {
                    const Icon = MENU_META[menuItem.id].icon;
                    const isActive = currentView === menuItem.id;
                    return (
                      <DropdownMenuItem
                        key={menuItem.id}
                        onSelect={() => setCurrentView(menuItem.id as AppState['currentView'])}
                        aria-current={isActive ? 'page' : undefined}
                        className={isActive ? 'bg-muted dark:bg-accent' : undefined}
                      >
                        <Icon className="mr-3 h-4 w-4 shrink-0" />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{t(`header.menu-${menuItem.id}`)}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>

          {/* Mobile Dropdown Menu (<768px) */}
          <DropdownMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={t('header.menu')}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 md:hidden">
              {visibleMenus.map(menuItem => {
                            const meta = MENU_META[menuItem.id];
                const Icon = meta.icon;
                const isActive = currentView === menuItem.id;
                return (
                  <DropdownMenuItem
                    key={menuItem.id}
                    onSelect={() => {
                      setCurrentView(menuItem.id as AppState['currentView']);
                      setMobileMenuOpen(false);
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={isActive ? 'bg-muted dark:bg-accent' : undefined}
                  >
                    <Icon className="mr-3 h-4 w-4" />
                    {t(`header.menu-${menuItem.id}`)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Actions */}
          <div className="flex items-center gap-2 sm:gap-3 hd-btns lg:shrink-0 lg:hd-btns">
            {taskPanel}
            <PageTranslationButton />
            {/* Theme Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                  aria-label={t('header.toggle-theme')}
                >
                  {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('header.toggle-theme')}</TooltipContent>
            </Tooltip>

            {/* User Profile */}
            {user && (
              <div className="flex items-center space-x-2 sm:space-x-3">
                <img
                  src={user.avatar_url}
                  alt={user.name || user.login}
                  className="w-8 h-8 rounded-full"
                />
                <div className="min-w-0 hidden sm:block lg:max-w-24">
                  <p className="truncate text-sm font-medium text-foreground">
                    {user.name || user.login}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        const confirmed = await confirm(
                          t('header.logout-confirmation'),
                          t('header.logout-only-clears-credentials-repositories-ai-a'),
                          { type: 'warning' }
                        );
                        if (confirmed) {
                          logout();
                        }
                      }}
                      aria-label={t('header.logout')}
                    >
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('header.logout')}</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
