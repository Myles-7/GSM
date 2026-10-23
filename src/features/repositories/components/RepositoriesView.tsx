import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CategorySidebar } from '../../../components/CategorySidebar';
import { RepositoryList } from '../../../components/RepositoryList';
import { SearchBar } from '../../../components/SearchBar';
import { useAppStore } from '../../../store/useAppStore';
import { useClassificationStore } from '../../../store/useClassificationStore';
import { hasActiveSearchFilters } from '../../../utils/repoSearch';
import { RepositoryViewControls } from './RepositoryViewControls';
import '../exploration/exploration.css';

const scrollPositions = new Map<string, number>();

/** Owns repository navigation; the shell never subscribes to the library. */
export const RepositoriesView = memo(function RepositoriesView() {
  const classification = useClassificationStore(useShallow(state => ({
    repositories: state.repositories,
    searchResults: state.searchResults,
    selectedCategory: state.selectedCategory,
    select: state.setSelectedCategory,
    similarView: state.similarView,
  })));
  const { repositoryViewMode, canonicalRepositories, searchFilters, exitSimilarView } = useAppStore(useShallow(state => ({
    repositoryViewMode: state.repositoryViewMode,
    canonicalRepositories: state.repositories,
    searchFilters: state.searchFilters,
    exitSimilarView: state.exitSimilarView,
  })));
  const isSearching = hasActiveSearchFilters(searchFilters);
  const owner = useAppStore(state => String(state.user?.id ?? 'anonymous'));
  const positionKey = `${owner}:${repositoryViewMode}`;
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) surface.current?.animate?.([{ opacity: .75 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
    const frame = requestAnimationFrame(() => window.scrollTo({ top: scrollPositions.get(positionKey) ?? 0, behavior: 'instant' }));
    return () => cancelAnimationFrame(frame);
  }, [positionKey]);
  useEffect(() => {
    const remember = () => scrollPositions.set(positionKey, window.scrollY);
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [positionKey]);
  const select = classification.select;

  useEffect(() => {
    if (classification.similarView?.active && isSearching) exitSimilarView();
  }, [classification.similarView?.active, isSearching, exitSimilarView]);

  const selectCategory = useCallback((category: string) => {
    if (useAppStore.getState().similarView?.active) exitSimilarView();
    select(category);
  }, [select, exitSimilarView]);

  const exploring = repositoryViewMode === 'cluster';
  const similar = classification.similarView?.active && !isSearching;
  const repositories = exploring ? canonicalRepositories
    : similar ? classification.similarView!.similarResults
    : isSearching ? classification.searchResults : classification.repositories;

  return (
    <section className="repository-workspace" data-mode={repositoryViewMode}>
      <header className="repository-workspace-header"><RepositoryViewControls mode={repositoryViewMode} onChange={mode => useAppStore.getState().setRepositoryViewMode(mode)} /></header>
    <div ref={surface} className="repository-workspace-body flex flex-col gap-4 lg:flex-row lg:gap-6">
      {!exploring && <CategorySidebar
        repositories={classification.repositories}
        selectedCategory={classification.selectedCategory}
        onCategorySelect={selectCategory}
      />}
      <div className="min-w-0 flex-1 space-y-3">
        <div hidden={exploring}><SearchBar /></div>
        <RepositoryList repositories={repositories} selectedCategory={similar ? 'all' : classification.selectedCategory} />
      </div>
    </div>
    </section>
  );
});
