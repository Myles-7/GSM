import { useState } from 'react';
import type { Category, Repository } from '../../../types';
import { useT } from '../../../i18n/useT';
import { useDialog } from '../../../hooks/useDialog';
import { Button } from '../../../components/ui/button';
import { assignConfirmedCategory } from './repositoryCategoryAssignment';

interface Props {
  repositories: Repository[];
  categories: Category[];
  selectedIds: Set<number>;
  onSelect: (id: number) => void;
  onSelectAll: () => void;
  onAssigned: () => void;
  onOpenRepository?: (repo: Repository) => void;
  visibleCount?: number;
}

export function PendingClassification({ repositories, categories, selectedIds, onSelect, onSelectAll, onAssigned, onOpenRepository, visibleCount = 50 }: Props) {
  const t = useT('repositories');
  const { confirm } = useDialog();
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const selected = repositories.filter(repo => selectedIds.has(repo.id));
  const ready = selected.length > 0 && selected.every(repo => categories.some(category => category.id === (targets[repo.id] || categoryId) && !['all', 'pending'].includes(category.id)));
  const apply = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (selected.some(repo => repo.category_locked) &&
        !await confirm(t('organization.lockedTitle'), t('organization.lockedConfirm'), { type: 'warning' })) return;
      selected.forEach(repo => assignConfirmedCategory(repo.id, targets[repo.id] || categoryId));
      setTargets({});
      onAssigned();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <h2 className="mr-auto text-sm font-semibold">{t('organization.pending')}</h2>
        <Button variant="ghost" size="sm" onClick={onSelectAll}>{t('organization.selectAll')} ({repositories.length})</Button>
        <select className="ui-field max-w-full p-2 text-sm" aria-label={t('organization.chooseCategory')} value={categoryId} onChange={event => setCategoryId(event.target.value)}>
          <option value="">{t('organization.chooseCategory')}</option>
          {categories.filter(category => category.id !== 'all' && category.id !== 'pending').map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <Button size="sm" disabled={!ready || busy} onClick={() => void apply()}>{t('organization.assignSelected', { count: selected.length })}</Button>
      </div>
      <div className="divide-y divide-border">
        {repositories.slice(0, visibleCount).map(repo => (
          <div key={repo.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_180px]">
            <label className="pt-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={selectedIds.has(repo.id)} onChange={() => onSelect(repo.id)} aria-label={`${t('organization.selectRepository')}: ${repo.name}`} />
            </label>
            <div className="min-w-0">
            <button type="button" className="text-left text-sm font-medium break-all hover:underline" onClick={() => onOpenRepository?.(repo)}>{repo.full_name}</button>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{repo.custom_description ?? repo.ai_summary ?? repo.description}</p>
            {!!repo.category_candidates?.length && <p className="mt-1 break-words text-xs text-muted-foreground">
              {t('organization.suggestions')}: {repo.category_candidates.map(id => categories.find(category => category.id === id)?.name ?? id).join(', ')}
            </p>}
            </div>
            <select className="ui-field col-start-2 min-w-0 w-full p-2 text-sm sm:col-start-auto" aria-label={`${t('organization.chooseCategory')}: ${repo.name}`} value={targets[repo.id] || categoryId} onChange={event => setTargets(previous => ({ ...previous, [repo.id]: event.target.value }))}>
              <option value="">{t('organization.chooseCategory')}</option>
              {categories.filter(category => !['all', 'pending'].includes(category.id)).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
