import { useT } from "../i18n/useT";
import { Button } from './ui/button';
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Edit3,
  Trash2,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Undo2,
  Inbox,
  Search,
  Plug,
  MoreHorizontal,
} from 'lucide-react';
import { Category, Repository } from '../types';
import { useClassificationStore as useAppStore, getAllCategories, sortCategoriesByOrder } from '../store/useClassificationStore';
import { useRepositoryDragStore } from '../store/useRepositoryDragStore';
import { useShallow } from 'zustand/react/shallow';
import { CategoryEditModal } from './CategoryEditModal';
import { useCategorySyncActions } from '../features/repositories/hooks/useCategorySyncActions';
import { matchesCategory } from '../utils/categoryUtils';
import { useDialog } from '../hooks/useDialog';
import { assignClassificationRepositories, captureClassificationEdit, repositoryIdsFromDrop } from '../features/repositories/components/classificationEditActions';
import { SubcategoryManagementDialog } from './SubcategoryManagementDialog';
import { subcategoryManagementRequest, type SubcategoryManagementRequest } from './subcategoryManagementRequest';
import { isElectron } from '../services/electronProxy';
import { useLocalVectorPendingCount } from '../features/settings/hooks/useLocalVectorPendingCount';
import { VectorPendingBadge } from './settings/VectorPendingBadge';
import { ClassificationSchemeSwitch } from './ClassificationSchemeSwitch';
import { ClassificationSidebarChildren } from './ClassificationSidebarChildren';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

interface CategorySidebarProps {
  repositories: Repository[];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
}

const AI_CATEGORY_EMOJIS: Record<string, string> = {
  ai: '🤖', developer: '🛠️', devtools: '🧰', data: '📊', web: '🌐', productivity: '⚡', knowledge: '📚',
  infrastructure: '🏗️', cloud: '☁️', security: '🛡️', media: '🎨', desktop: '🖥️', mobile: '📱',
  education: '🔬', game: '🎮', business: '🤝', open: '🔗', protocol: '🔗', runtime: '💻',
  retrieval: '🔎', storage: '🗄️', other: '📁', unclassified: '🧭',
};

function categoryIcon(category: Category): React.ReactNode {
  if (category.source === 'ai') {
    const root = category.sourceKey?.split('/')[0] ?? '';
    return AI_CATEGORY_EMOJIS[root] ?? '📁';
  }
  return category.icon === 'folder' ? '📁' : category.icon;
}

export const CategorySidebar: React.FC<CategorySidebarProps> = ({
  repositories,
  selectedCategory,
  onCategorySelect
}) => {
  const {
    customCategories,
    hiddenDefaultCategoryIds,
    defaultCategoryOverrides,
    classificationContext,
    categoryOrder,
    collapsedSidebarCategoryCount,
    categoryMatchMode,
    deleteCustomCategory,
    hideDefaultCategory,
    showDefaultCategory,
    language,
    isSidebarCollapsed,
    setSidebarCollapsed,
    setCurrentView,
    subcategories,
    classificationNavigation,
    activeClassificationScheme,
    setClassificationExpanded,
  } = useAppStore(useShallow((state) => ({
    customCategories: state.customCategories,
    hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
    defaultCategoryOverrides: state.defaultCategoryOverrides,
    classificationContext: state.classificationContext,
    categoryOrder: state.categoryOrder,
    collapsedSidebarCategoryCount: state.collapsedSidebarCategoryCount,
    categoryMatchMode: state.categoryMatchMode,
    deleteCustomCategory: state.deleteCustomCategory,
    hideDefaultCategory: state.hideDefaultCategory,
    showDefaultCategory: state.showDefaultCategory,
    language: state.language,
    isSidebarCollapsed: state.isSidebarCollapsed,
    setSidebarCollapsed: state.setSidebarCollapsed,
    setCurrentView: state.setCurrentView,
    subcategories: state.subcategories,
    classificationNavigation: state.classificationNavigation,
    activeClassificationScheme: state.activeClassificationScheme ?? 'purpose',
    setClassificationExpanded: state.setClassificationExpanded,
  })));

  const { toast, confirm } = useDialog();
  const { forceSyncToBackend } = useCategorySyncActions();
  const organizationT = useT('repositories');
  const t = useT('app');
  const localVectorPendingCount = useLocalVectorPendingCount();
  // 仓库卡片拖拽中：驱动「全部分类」变为「取消分类」热区提示
  const isRepoDragging = useRepositoryDragStore((state) => state.isDragging);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [subcategoryRequest, setSubcategoryRequest] = useState<SubcategoryManagementRequest | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  // 用于防止拖拽后触发点击的标志
  const justDroppedRef = useRef(false);
  const dropTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // isMobile 初始值从 window.innerWidth 同步获取（SSR安全）
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 1024;
  });
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  // 控制文字显示的状态：等侧栏展开动效完成后再显示文字
  const [showText, setShowText] = useState(!isSidebarCollapsed);

  // 用于存储 showText 定时器的 ref
  const showTextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 用于存储 toggleSidebar 定时器的 ref
  const toggleSidebarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 分类列表滚动容器的 ref
  const categoryListRef = useRef<HTMLDivElement>(null);
  // 滚动条显示定时器 ref
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);

  // 监听侧栏状态变化，同步更新文字显示状态
  useEffect(() => {
    if (isSidebarCollapsed) {
      setShowText(false);
    } else {
      // 清除之前的定时器
      if (showTextTimerRef.current) {
        clearTimeout(showTextTimerRef.current);
      }
      // 侧栏展开时，延迟显示文字，使用更短的延迟让体验更流畅
      showTextTimerRef.current = setTimeout(() => setShowText(true), 150);
    }
    return () => {
      if (showTextTimerRef.current) {
        clearTimeout(showTextTimerRef.current);
      }
    };
  }, [isSidebarCollapsed]);

  // 检测屏幕尺寸
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 切换侧栏折叠状态
  const toggleSidebar = useCallback(() => {
    // 清除之前的定时器
    if (toggleSidebarTimerRef.current) {
      clearTimeout(toggleSidebarTimerRef.current);
    }
    if (isSidebarCollapsed) {
      // 展开侧栏：先展开，再显示文字
      setSidebarCollapsed(false);
      toggleSidebarTimerRef.current = setTimeout(() => setShowText(true), 150); // 150ms 后显示文字，配合动效
    } else {
      // 折叠侧栏：先隐藏文字，再折叠
      setShowText(false);
      toggleSidebarTimerRef.current = setTimeout(() => setSidebarCollapsed(true), 120); // 120ms 后折叠，文字先消失
    }
  }, [isSidebarCollapsed, setSidebarCollapsed]);

  // 处理分类列表滚动事件
  const handleCategoryScroll = useCallback(() => {
    setIsScrolling(true);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    // 滚动停止 1 秒后隐藏滚动条
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 1000);
  }, []);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (toggleSidebarTimerRef.current) {
        clearTimeout(toggleSidebarTimerRef.current);
      }
      if (dropTimeoutRef.current) {
        clearTimeout(dropTimeoutRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // 键盘快捷键支持 (Ctrl/Cmd + B)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const isEditable = active?.tagName === 'INPUT' ||
                         active?.tagName === 'TEXTAREA' ||
                         active?.isContentEditable ||
                         active?.getAttribute('role') === 'textbox';
      if (isEditable) return;

      // 移动端时键盘快捷键不执行折叠切换，避免修改持久化状态
      if (isMobile) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, isMobile]);

  const allCategories = useMemo(() => {
    const categories = getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides, classificationContext);
    const sorted = sortCategoriesByOrder(categories, categoryOrder);
    const pending: Category = { id: 'pending', name: organizationT('organization.pending'), icon: '', keywords: [] };
    return [...sorted.filter(category => category.id === 'all'), ...sorted.filter(category => category.id !== 'all' && category.id !== 'pending'), pending];
  }, [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides, classificationContext, categoryOrder, organizationT]);


  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set('all', repositories.length);
    counts.set('pending', repositories.filter(repo => repo.category_id == null).length);
    
    for (const category of allCategories) {
      if (category.id === 'all' || category.id === 'pending') continue;
      const isAICategory = category.source === 'ai';
      const count = isAICategory
        ? repositories.filter(repo => activeClassificationScheme === 'technology'
          ? repo.classifications?.technology?.categoryId === category.id
          : repo.category_id === category.id).length
        : repositories.filter(repo => matchesCategory(repo, category, categoryMatchMode)).length;
      counts.set(category.id, count);
    }
    return counts;
  }, [repositories, allCategories, categoryMatchMode, activeClassificationScheme]);

  useEffect(() => {
    const list = categoryListRef.current;
    if (!list) return;
    if (typeof list.scrollTo === 'function') list.scrollTo({ top: 0, behavior: 'auto' });
    else list.scrollTop = 0;
  }, [activeClassificationScheme]);

  const expanded = classificationNavigation?.[activeClassificationScheme]?.expanded ?? [];
  const parentIds = new Set((subcategories ?? []).map(group => group.parentId));
  useEffect(() => {
    const parent = subcategories?.find(group => group.id === selectedCategory)?.parentId;
    if (!parent) return;
    const current = useAppStore.getState().classificationNavigation?.[activeClassificationScheme]?.expanded ?? [];
    if (!current.includes(parent)) setClassificationExpanded(activeClassificationScheme, [...current, parent]);
  }, [selectedCategory, activeClassificationScheme, subcategories, setClassificationExpanded]);

  const toggleCategory = (categoryId: string) => {
    if (justDroppedRef.current || !parentIds.has(categoryId)) return;
    setClassificationExpanded(activeClassificationScheme, expanded.includes(categoryId)
      ? expanded.filter(id => id !== categoryId) : [...expanded, categoryId]);
  };
  const renderCategoryToggle = (category: Category) => parentIds.has(category.id) ? (
    <Button variant="ghost" size="icon" className="absolute left-0 top-0.5 z-10 h-8 w-6" title={organizationT(expanded.includes(category.id) ? 'dualOrganization.collapse' : 'dualOrganization.expand', { name: category.name })}
      aria-label={organizationT(expanded.includes(category.id) ? 'dualOrganization.collapse' : 'dualOrganization.expand', { name: category.name })}
      aria-expanded={expanded.includes(category.id)} aria-controls={expanded.includes(category.id) ? `category-children-${category.id}` : undefined}
      onClick={event => { event.stopPropagation(); toggleCategory(category.id); }}>
      {expanded.includes(category.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </Button>
  ) : null;

  const getCategoryCount = useCallback((category: Category) => {
    return categoryCounts.get(category.id) ?? 0;
  }, [categoryCounts]);

  const handleAddCategory = () => {
    setIsCreatingCategory(true);
    setEditingCategory(null);
    setEditModalOpen(true);
  };

  const handleEditCategory = (category: Category) => {
    setIsCreatingCategory(false);
    setEditingCategory(category);
    setEditModalOpen(true);
  };

  const handleDeleteCategory = async (category: Category) => {
    const confirmed = await confirm(
      t('categorySidebar.delete-category-confirmation'),
      organizationT('organization.deleteCategoryImpact', {
        name: category.name,
        repositories: repositories.filter(repo => repo.category_id === category.id).length,
        groups: useAppStore.getState().subcategories.filter(group => group.parentId === category.id).length,
      }),
      { type: 'danger', confirmText: t('categorySidebar.delete') }
    );

    if (!confirmed) return;

    deleteCustomCategory(category.id);
    try {
      await forceSyncToBackend();
    } catch {
      toast(t('categorySidebar.failed-to-delete-category-please-check-backend-c'), 'error');
    }
  };

  const handleHideDefaultCategory = async (category: Category) => {
    const confirmed = await confirm(
      t('categorySidebar.hide-category-confirmation'),
      t('categorySidebar.hide-default-category-v1-this-will-not-delete-an', { v1: category.name }),
      { type: 'warning' }
    );

    if (!confirmed) return;

    hideDefaultCategory(category.id);
    try {
      await forceSyncToBackend();
    } catch {
      showDefaultCategory(category.id);
      toast(t('categorySidebar.failed-to-hide-category-please-check-backend-con'), 'error');
    }
  };

  const handleCloseModal = () => {
    setEditModalOpen(false);
    setEditingCategory(null);
    setIsCreatingCategory(false);
  };

  const handleDropOnCategory = async (event: React.DragEvent<HTMLDivElement>, category: Category) => {
    event.preventDefault(); event.stopPropagation(); setDragOverCategoryId(null);
    justDroppedRef.current = true;
    if (dropTimeoutRef.current) clearTimeout(dropTimeoutRef.current);
    dropTimeoutRef.current = setTimeout(() => { justDroppedRef.current = false; }, 300);
    const ids = repositoryIdsFromDrop(event.dataTransfer);
    const captured = captureClassificationEdit(activeClassificationScheme);
    useRepositoryDragStore.getState().endDrag();
    if (!ids.length) return;
    try {
      await assignClassificationRepositories(ids, { categoryId: category.id === 'all' || category.id === 'pending' ? null : category.id, subcategoryId: null }, { confirm, toast }, captured);
    } catch (error) { toast(error instanceof Error ? error.message : String(error), 'error'); }
  };
  // 处理分类点击，防止拖拽后立即触发
  const handleCategoryClick = (categoryId: string) => {
    if (justDroppedRef.current) {
      return;
    }
    if (parentIds.has(categoryId)) {
      if (selectedCategory === categoryId) toggleCategory(categoryId);
      else setClassificationExpanded(activeClassificationScheme, [...new Set([...expanded, categoryId])]);
    }
    onCategorySelect(categoryId);
    if (isMobile) setMobileTreeOpen(false);
  };

  const renderSettingsShortcuts = (collapsed: boolean) => {
    const shortcuts = [
      { tab: 'vectorSearch', label: t('settingsPanel.vector-search'), icon: Search },
      ...(isElectron() ? [{
        tab: 'plugins', label: t('settingsPanel.plugin-management', { defaultValue: 'Plugin Management' }), icon: Plug,
      }] : []),
    ];
    return (
      <nav aria-label={t('settingsPanel.settings-tabs')} className={`mt-3 shrink-0 border-t border-border pt-3 ${collapsed ? 'space-y-2' : 'flex flex-wrap gap-2 lg:block lg:space-y-1'}`}>
        {shortcuts.map(({ tab, label, icon: Icon }) => (
          <Button
            key={tab}
            variant="ghost"
            size={collapsed ? 'icon' : 'sm'}
            title={label}
            aria-label={label}
            aria-description={tab === 'vectorSearch' && localVectorPendingCount > 0
              ? t('vectorSearchSettings.local-pending-count', { count: localVectorPendingCount, defaultValue: '{{count}} locally known pending' })
              : undefined}
            className={collapsed ? 'relative h-8 w-8' : 'h-auto min-h-9 gap-2 lg:w-full lg:justify-start'}
            onClick={() => {
              sessionStorage.setItem('gsm:pending-settings-tab', tab);
              setCurrentView('settings');
            }}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span className="min-w-0 whitespace-normal text-left">{label}</span>}
            {tab === 'vectorSearch' && (
              <span className={collapsed ? 'pointer-events-none absolute -right-3 -top-2' : 'ml-auto'}>
                <VectorPendingBadge count={localVectorPendingCount} t={t} />
              </span>
            )}
          </Button>
        ))}
      </nav>
    );
  };

  const collapsed = !isMobile && isSidebarCollapsed;
  const visibleCategories = collapsed ? (() => {
    const normal = allCategories.filter(category => category.id !== 'all' && category.id !== 'pending');
    const shown = normal.slice(0, Math.max(1, collapsedSidebarCategoryCount - 2));
    const selected = normal.find(category => category.id === selectedCategory);
    if (selected && !shown.includes(selected)) shown[shown.length - 1] = selected;
    return [...allCategories.filter(category => category.id === 'all'), ...shown, ...allCategories.filter(category => category.id === 'pending')];
  })() : allCategories;

  const selectedSubgroup = (subcategories ?? []).find(group => group.id === selectedCategory);
  const selectedCategoryRecord = allCategories.find(category => category.id === selectedCategory);
  const selectedLabel = selectedSubgroup?.name ?? selectedCategoryRecord?.name ?? selectedCategory;
  const selectedCount = selectedSubgroup ? repositories.filter(repo => repo.subcategory_id === selectedSubgroup.id && repo.category_id === selectedSubgroup.parentId).length : selectedCategoryRecord ? getCategoryCount(selectedCategoryRecord) : 0;
  const mobileToggleLabel = language.startsWith('zh') ? (mobileTreeOpen ? '收起分类' : '浏览分类') : (mobileTreeOpen ? 'Hide categories' : 'Browse categories');
  return <>
    <div className="relative z-10 shrink-0 lg:sticky lg:top-16 lg:self-start">
      <div data-classification-sidebar className={`linear-sidebar relative flex min-h-0 flex-col overflow-hidden ${isMobile ? 'w-full p-3' : collapsed ? 'w-14 p-2' : 'w-72 p-4'}`}
        style={{ height: isMobile ? mobileTreeOpen ? 'min(24rem, calc(100dvh - 6rem))' : 'auto' : 'min(48rem, calc(100dvh - 8rem))' }}>
        <div className={`flex shrink-0 items-center mb-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
          {!collapsed && <h2 className="text-base font-semibold text-card-foreground">{t('categorySidebar.categories')}</h2>}
          <div className="flex items-center gap-1">
            {!collapsed && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleAddCategory} title={t('categorySidebar.add-category')} aria-label={t('categorySidebar.add-category')}><Plus className="h-4 w-4" /></Button>}
            {!isMobile && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleSidebar} title={t(collapsed ? 'categorySidebar.expand-sidebar-ctrl-cmd-b' : 'categorySidebar.collapse-sidebar-ctrl-cmd-b')} aria-label={t(collapsed ? 'categorySidebar.expand-sidebar' : 'categorySidebar.collapse-sidebar')} aria-expanded={!collapsed}>{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</Button>}
          </div>
        </div>
        {!collapsed && <div className="shrink-0"><ClassificationSchemeSwitch /></div>}
        {isMobile && <Button type="button" variant="outline" className="mb-1 h-auto min-h-9 shrink-0 justify-between gap-2 px-2 py-2" aria-label={mobileToggleLabel} aria-expanded={mobileTreeOpen} aria-controls={mobileTreeOpen ? 'mobile-classification-tree' : undefined} onClick={() => setMobileTreeOpen(open => !open)}><span className="shrink-0 text-xs">{mobileToggleLabel}</span><span className="min-w-0 flex-1 line-clamp-2 break-words whitespace-normal text-left text-xs">{selectedLabel}</span><span className="shrink-0 text-xs tabular-nums">{selectedCount}</span>{mobileTreeOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}</Button>}
        {(!isMobile || mobileTreeOpen) && <div id={isMobile ? 'mobile-classification-tree' : undefined} data-classification-scroll ref={categoryListRef} onScroll={handleCategoryScroll} className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden category-scrollbar ${isScrolling ? 'is-scrolling' : ''}`}>
          <div className="space-y-1">
            {visibleCategories.map(category => {
              const isSelected = selectedCategory === category.id;
              const isDragTarget = dragOverCategoryId === category.id;
              const isUncategorizeHotspot = category.id === 'all' && isRepoDragging;
              const system = category.id === 'all' || category.id === 'pending';
              return <div key={category.id} className="group relative min-w-0"
                onDragOver={event => { event.preventDefault(); setDragOverCategoryId(category.id); }}
                onDragLeave={() => { if (dragOverCategoryId === category.id) setDragOverCategoryId(null); }}
                onDrop={event => handleDropOnCategory(event, category)}>
                {!collapsed && renderCategoryToggle(category)}
                <div className="flex min-w-0 items-start gap-0.5">
                  <Button variant="ghost" size={collapsed ? 'icon' : 'sm'} onClick={() => handleCategoryClick(category.id)} aria-pressed={isSelected} aria-current={isSelected ? 'page' : undefined}
                    aria-label={collapsed ? (isUncategorizeHotspot ? t('categorySidebar.uncategorize') : category.name) : undefined}
                    title={isUncategorizeHotspot ? t('categorySidebar.uncategorize-drop-here-to-remove-category') : category.name}
                    className={`${collapsed ? 'h-8 w-8 text-lg mx-auto' : 'h-auto min-h-9 min-w-0 flex-1 justify-between gap-2 py-2 pl-7 pr-1 text-left'} ${isDragTarget ? 'bg-success/10 text-success ring-1 ring-success/40' : isUncategorizeHotspot ? 'border border-dashed border-warning/50 text-warning' : isSelected ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent'} ${!collapsed && !showText && !isMobile ? 'opacity-0' : ''}`}>
                    {collapsed ? (isUncategorizeHotspot ? <Undo2 className="h-4 w-4" /> : category.id === 'pending' ? <Inbox className="h-4 w-4" /> : categoryIcon(category)) : <>
                      <span className="flex min-w-0 flex-1 items-center gap-2"><span className="shrink-0 text-base">{isUncategorizeHotspot ? <Undo2 className="h-4 w-4" /> : category.id === 'pending' ? <Inbox className="h-4 w-4" /> : categoryIcon(category)}</span><span className="min-w-0 whitespace-normal break-words line-clamp-2 text-sm font-medium">{isUncategorizeHotspot ? t('categorySidebar.uncategorize') : category.name}</span></span>
                      <span className={`shrink-0 min-w-6 rounded px-1.5 py-0.5 text-center text-xs tabular-nums ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{getCategoryCount(category)}</span>
                    </>}
                  </Button>
                  {!collapsed && !system && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="mt-1 h-7 w-6 shrink-0" aria-label={`${category.name} ${language.startsWith('zh') ? '操作' : 'actions'}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setSubcategoryRequest(subcategoryManagementRequest('create', category.id))}><Plus className="mr-2 h-3.5 w-3.5" />{language.startsWith('zh') ? '添加二级分类' : 'Add subgroup'}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleEditCategory(category)}><Edit3 className="mr-2 h-3.5 w-3.5" />{t('categorySidebar.edit-category')}</DropdownMenuItem>
                    {category.isCustom ? <DropdownMenuItem onSelect={() => { void handleDeleteCategory(category); }}><Trash2 className="mr-2 h-3.5 w-3.5" />{t('categorySidebar.delete-category')}</DropdownMenuItem> : <DropdownMenuItem onSelect={() => { void handleHideDefaultCategory(category); }}><EyeOff className="mr-2 h-3.5 w-3.5" />{t('categorySidebar.hide-default-category')}</DropdownMenuItem>}
                  </DropdownMenuContent></DropdownMenu>}
                </div>
                {!collapsed && <ClassificationSidebarChildren categoryId={category.id} onCategorySelect={id => { onCategorySelect(id); if (isMobile) setMobileTreeOpen(false); }} />}
              </div>;
            })}
          </div>
        </div>}
        {renderSettingsShortcuts(collapsed)}
      </div>
    </div>
    {subcategoryRequest && <SubcategoryManagementDialog key={`${subcategoryRequest.type}-${subcategoryRequest.parentId}`} request={subcategoryRequest} onClose={() => setSubcategoryRequest(null)} />}
    <CategoryEditModal isOpen={editModalOpen} onClose={handleCloseModal} category={editingCategory} isCreating={isCreatingCategory} />
  </>;
};
