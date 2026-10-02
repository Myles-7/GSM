import { useState } from 'react';
import { ExternalLink, Star } from 'lucide-react';
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

export function PendingClassification({
  repositories,
  categories,
  selectedIds,
  onSelect,
  onSelectAll,
  onAssigned,
  onOpenRepository,
  visibleCount = 50,
}: Props) {
  const t = useT('repositories');
  const { confirm } = useDialog();
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const selected = repositories.filter(repo => selectedIds.has(repo.id));
  const validCategories = categories.filter(c => c.id !== 'all' && c.id !== 'pending');
  const ready = selected.length > 0 && selected.every(repo =>
    validCategories.some(category => category.id === (targets[repo.id] || categoryId))
  );

  const apply = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (
        selected.some(repo => repo.category_locked) &&
        !await confirm(t('organization.lockedTitle'), t('organization.lockedConfirm'), { type: 'warning' })
      ) {
        return;
      }
      selected.forEach(repo => assignConfirmedCategory(repo.id, targets[repo.id] || categoryId));
      setTargets({});
      onAssigned();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        <h2 className="mr-auto text-sm font-semibold tracking-tight">{t('organization.pending')}</h2>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onSelectAll}>
          {t('organization.selectAll')} ({repositories.length})
        </Button>
        <select
          className="ui-field max-w-full rounded-md border border-border/70 bg-background px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
          aria-label={t('organization.chooseCategory')}
          value={categoryId}
          onChange={event => setCategoryId(event.target.value)}
        >
          <option value="">{t('organization.chooseCategory')}</option>
          {validCategories.map(category => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <Button size="sm" className="h-8 text-xs" disabled={!ready || busy} onClick={() => void apply()}>
          {t('organization.assignSelected', { count: selected.length })}
        </Button>
      </div>

      <div className="space-y-2.5">
        {repositories.slice(0, visibleCount).map(repo => (
          <div
            key={repo.id}
            className="flex flex-col gap-3 rounded-xl border border-border/50 bg-card/40 p-3 sm:flex-row sm:items-center hover:bg-card/70 transition-colors"
          >
            <div className="flex items-center gap-3 shrink-0">
              <label className="cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.has(repo.id)}
                  onChange={() => onSelect(repo.id)}
                  aria-label={`${t('organization.selectRepository')}: ${repo.name}`}
                  className="rounded border-border text-primary focus:ring-primary"
                />
              </label>
              {repo.owner?.avatar_url && (
                <img
                  src={repo.owner.avatar_url}
                  alt={repo.owner.login || repo.name}
                  className="h-8 w-8 rounded-full border border-border/40 object-cover shrink-0"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="text-left text-sm font-medium break-all hover:text-primary hover:underline"
                  onClick={() => onOpenRepository?.(repo)}
                >
                  {repo.full_name}
                </button>
                {repo.html_url && (
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="GitHub"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {typeof repo.stargazers_count === 'number' && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                    <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                    {repo.stargazers_count.toLocaleString()}
                  </span>
                )}
                {repo.language && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                    {repo.language}
                  </span>
                )}
              </div>

              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {repo.custom_description ?? repo.ai_summary ?? repo.description}
              </p>

              {!!repo.category_candidates?.length && (
                <p className="mt-1.5 break-words text-xs text-muted-foreground">
                  {t('organization.suggestions')}: {repo.category_candidates.map(id => categories.find(category => category.id === id)?.name ?? id).join(', ')}
                </p>
              )}
            </div>

            <div className="shrink-0 sm:w-44">
              <select
                className="ui-field w-full rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none transition-colors"
                aria-label={`${t('organization.chooseCategory')}: ${repo.name}`}
                value={targets[repo.id] || categoryId}
                onChange={event => setTargets(previous => ({ ...previous, [repo.id]: event.target.value }))}
              >
                <option value="">{t('organization.chooseCategory')}</option>
                {validCategories.map(category => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
