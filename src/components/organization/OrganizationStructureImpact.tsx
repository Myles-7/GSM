import { GitMerge, LockKeyhole, RotateCcw, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { useT } from '../../i18n/useT';
import type { OrganizationController } from '../DualOrganizationWizard';
import { categorySubgroupLabel, categoryTreeIssueKey } from './categoryTreePresentation';

export function OrganizationStructureImpact({ controller: c, categoryId }: { controller: OrganizationController; categoryId: string | null }) {
  const t = useT('repositories'); const scheme = c.proposal?.organization?.dual?.schemes[c.reviewScheme];
  const operations = scheme?.structureOperations?.filter(op => ['pending', 'conflict'].includes(op.status) && (!categoryId || [op.targetId, ...op.sourceIds].includes(categoryId))) ?? [];
  const label = (id: string) => scheme?.categories.find(cat => cat.id === id)?.name ?? id;
  if (!operations.length) return null;
  return <div className="max-h-48 space-y-2 overflow-y-auto border-b pb-3" data-structure-impact>{operations.map(op => {
    const blocked = c.treePreview?.deferred.find(row => row.schemeId === c.reviewScheme && row.operationId === op.id);
    return <div key={op.id} className="border-l-2 border-primary pl-3 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-2"><GitMerge className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 break-words font-medium">{op.kind === 'merge' ? op.sourceIds.map(label).join(' + ') + ' → ' + op.name : t(`categoryTree.${op.kind}`) + ': ' + op.name}</span><Button size="icon" variant="ghost" className="h-6 w-6" disabled={c.busy || c.readonly} aria-label={t('categoryTree.withdraw')} title={t('categoryTree.withdraw')} onClick={() => void c.editTree(c.reviewScheme, { kind: 'withdraw', operationId: op.id })}><RotateCcw className="h-3 w-3" /></Button></div>
      {op.kind === 'merge' && <><p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground"><span>{t('categoryTree.mergeImpact', { count: op.members.length })}</span><span className="inline-flex items-center gap-1"><LockKeyhole className="h-3 w-3" />{op.members.filter(member => member.before.locked && member.before.categoryId !== op.targetId).length}</span></p><details className="mt-1"><summary className="cursor-pointer text-muted-foreground">{t('categoryTree.mapping')}</summary><div className="mt-2 space-y-1">{op.categoriesBefore.filter(cat => cat.parentId && [op.targetId, ...op.sourceIds].includes(cat.parentId)).map(cat => {
        const members = op.members.filter(member => member.before.subcategoryId === cat.id);
        const targets = [...new Set(members.map(member => scheme?.entries.find(entry => entry.repositoryId === member.repositoryId)?.subcategoryId ?? null))];
        const mapped = targets.length ? targets.map(id => id ? categorySubgroupLabel(scheme!.categories.find(child => child.id === id)!, scheme) : t('organization.ungrouped')).join(' / ') : label(cat.id);
        return <p key={cat.id} className="break-words">{label(cat.parentId!)} / {cat.name} → {op.name} / {mapped}</p>;
      })}</div></details><Button size="sm" variant="ghost" className="mt-1 h-6 px-0 text-xs" disabled={c.busy || c.readonly || !c.configId} onClick={() => void c.redesignMerge(c.reviewScheme, op.id)}><Sparkles className="mr-1.5 h-3 w-3" />{t('categoryTree.redesign')}</Button></>}
      {blocked && <p className="mt-1 break-words text-amber-700 dark:text-amber-400">{t('categoryTree.deferred')}: {categoryTreeIssueKey(blocked.reason) ? t(categoryTreeIssueKey(blocked.reason)!) : blocked.reason}</p>}
    </div>;
  })}</div>;
}
