import { Check, ChevronLeft, GitMerge } from 'lucide-react';
import { Button } from '../ui/button';
import { useT } from '../../i18n/useT';
import type { OrganizationController } from '../DualOrganizationWizard';
import { categoryTreeIssueKey } from './categoryTreePresentation';

export function OrganizationApplicationReview({ controller: c, revision, onCancel }: { controller: OrganizationController; revision: string; onCancel: () => void }) {
  const t = useT('repositories'); const preview = c.treePreview;
  const eligibleOps = preview?.eligible.flatMap(row => c.proposal?.organization?.dual?.schemes[row.schemeId].structureOperations?.filter(op => row.operationIds.includes(op.id)).map(op => ({ ...op, schemeId: row.schemeId })) ?? []) ?? [];
  const assignments = preview?.eligible.reduce((sum, row) => sum + row.repositoryIds.length, 0) ?? 0;
  const stale = c.proposal?.updatedAt !== revision;
  return <section className="flex min-h-0 flex-1 flex-col" data-category-application-review>
    <div className="flex shrink-0 items-center gap-3 border-b px-5 py-3"><Button autoFocus variant="ghost" size="icon" className="h-8 w-8" aria-label={t('categoryTree.backPreview')} onClick={onCancel}><ChevronLeft className="h-4 w-4" /></Button><h2 className="text-sm font-semibold">{t('categoryTree.confirmTitle')}</h2></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
      <h3 className="text-sm font-semibold">{t('categoryTree.eligible', { structures: eligibleOps.length, assignments })}</h3>
      <div className="mt-3 divide-y">{eligibleOps.map(op => <div key={op.id} className="flex items-start gap-3 py-3 text-sm"><GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 break-words">{t(`dualOrganization.${op.schemeId}Short`)} · {t(`categoryTree.${op.kind}`)} · {op.name}</span><Check className="h-4 w-4 shrink-0 text-emerald-600" /></div>)}</div>
      {preview?.transactions.map(transaction => {
        const before = transaction.structureChange?.expected; const after = transaction.structureChange?.next;
        if (!before || !after) return null;
        const removed = before.customCategories.filter(cat => !after.customCategories.some(next => next.id === cat.id)).map(cat => cat.name);
        const hidden = after.hiddenDefaultCategoryIds.filter(id => !before.hiddenDefaultCategoryIds.includes(id)).map(id => c.proposal?.organization?.dual?.schemes[transaction.schemeId ?? 'purpose'].categories.find(cat => cat.id === id)?.name ?? id);
        return removed.length || hidden.length ? <p key={transaction.schemeId} className="mt-4 border-l-2 border-primary pl-3 text-xs leading-6">{t('categoryTree.cleanupNames', { names: [...removed, ...hidden].join('、') })}</p> : null;
      })}
      {!!preview?.deferred.length && <section className="mt-6 border-t pt-4"><h3 className="text-sm font-semibold">{t('categoryTree.deferredCount', { count: preview.deferred.length })}</h3>{preview.deferred.map(row => <div key={`${row.schemeId}:${row.operationId}`} className="border-b py-3 text-xs"><p className="font-medium">{t(`dualOrganization.${row.schemeId}Short`)} · {c.proposal?.organization?.dual?.schemes[row.schemeId].structureOperations?.find(op => op.id === row.operationId)?.name ?? t('categoryTree.cleanup')}</p><p className="mt-1 break-words leading-5 text-muted-foreground">{categoryTreeIssueKey(row.reason) ? t(categoryTreeIssueKey(row.reason)!) : row.reason}</p></div>)}</section>}
      {!!preview?.conflicts.length && <p className="mt-4 text-xs text-amber-700 dark:text-amber-400">{t('categoryTree.conflictCount', { count: preview.conflicts.length })}</p>}
      <p className="mt-5 text-xs leading-6 text-muted-foreground">{t('categoryTree.confirmHint')}</p>
      {stale && <p role="alert" className="mt-3 text-sm text-destructive">{t('categoryTree.stale')}</p>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-muted/10 px-5 py-3"><Button variant="outline" size="sm" onClick={onCancel}>{t('categoryTree.backPreview')}</Button><Button size="sm" className="ml-auto" disabled={stale || c.busy || c.readonly || !preview?.transactions.length} onClick={async () => { await c.apply(); onCancel(); }}><Check className="mr-2 h-3.5 w-3.5" />{t('categoryTree.confirmApply')}</Button></div>
  </section>;
}
