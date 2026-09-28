import { useState, type ReactNode } from 'react';
import type { Category, Repository } from '../../../types';
import { useT } from '../../../i18n/useT';
import { useDialog } from '../../../hooks/useDialog';
import { Button } from '../../../components/ui/button';
import { RepositoryGrid } from './RepositoryGrid';
import { assignConfirmedCategory } from './repositoryCategoryAssignment';

interface Props {
  repositories: Repository[];
  categories: Category[];
  selectedIds: Set<number>;
  onSelect: (id: number) => void;
  onSelectAll: () => void;
  onAssigned: () => void;
  renderRepository: (repo: Repository) => ReactNode;
  viewMode: 'grid' | 'list';
  visibleCount?: number;
}

export function PendingClassification({ repositories, categories, selectedIds, onSelect, onSelectAll, onAssigned, renderRepository, viewMode, visibleCount = 50 }: Props) {
  const t = useT('repositories');
  const { confirm } = useDialog();
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = repositories.filter(repo => selectedIds.has(repo.id));
  const apply = async () => {
    if (!categoryId || !selected.length || busy) return;
    setBusy(true);
    try {
      if (selected.some(repo => repo.category_locked) &&
        !await confirm(t('organization.lockedTitle'), t('organization.lockedConfirm'), { type: 'warning' })) return;
      selected.forEach(repo => assignConfirmedCategory(repo.id, categoryId));
      onAssigned();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <h2 className="mr-auto text-sm font-semibold">{t('organization.pending')}</h2>
        <Button variant="ghost" size="sm" onClick={onSelectAll}>{t('organization.selectAll')}</Button>
        <select className="ui-field max-w-full p-2 text-sm" aria-label={t('organization.chooseCategory')} value={categoryId} onChange={event => setCategoryId(event.target.value)}>
          <option value="">{t('organization.chooseCategory')}</option>
          {categories.filter(category => category.id !== 'all' && category.id !== 'pending').map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <Button size="sm" disabled={!categoryId || !selected.length || busy} onClick={() => void apply()}>{t('organization.assignSelected', { count: selected.length })}</Button>
      </div>
      <RepositoryGrid viewMode={viewMode}>
        {repositories.slice(0, visibleCount).map(repo => (
          <div key={repo.id} className="min-w-0">
            <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={selectedIds.has(repo.id)} onChange={() => onSelect(repo.id)} aria-label={`${t('organization.selectRepository')}: ${repo.name}`} />
              <span className="truncate">{repo.full_name}</span>
            </label>
            {renderRepository(repo)}
            {!!repo.category_candidates?.length && <p className="mt-1 break-words text-xs text-muted-foreground">
              {t('organization.suggestions')}: {repo.category_candidates.map(id => categories.find(category => category.id === id)?.name ?? id).join(', ')}
            </p>}
          </div>
        ))}
      </RepositoryGrid>
    </div>
  );
}
