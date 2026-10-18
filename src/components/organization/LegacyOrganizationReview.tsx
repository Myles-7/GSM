import { ArrowRight, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { useT } from '../../i18n/useT';
import type { OrganizationController } from '../DualOrganizationWizard';

export function LegacyOrganizationReview({ controller: c }: { controller: OrganizationController }) {
  const t = useT('repositories'); const draft = c.proposal?.organization;
  const label = (id: string | null) => draft?.categories.find(cat => cat.id === id)?.name ?? t('organization.pending');
  const byId = new Map(c.repositories.map(repo => [repo.id, repo]));
  return <section className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
    <div className="flex flex-wrap items-center gap-3 border-b pb-4"><h2 className="min-w-0 flex-1 text-sm font-semibold">{t('organizationUx.history')}</h2><select className="h-8 rounded-md border bg-background px-2 text-xs" aria-label={t('aiOrganization.version')} value={c.proposal?.id ?? ''} disabled={c.busy} onChange={e => c.selectVersion(e.target.value)}>{c.versions.map(proposal => <option key={proposal.id} value={proposal.id}>{t('aiOrganization.revision', { count: proposal.organization!.revision })}</option>)}</select></div>
    <p className="py-3 text-xs leading-6 text-muted-foreground">{t('categoryTree.legacyHint')}</p>
    {draft?.structureOperations?.map(op => <div key={op.id} className="flex flex-wrap items-center gap-3 border-b py-3 text-sm"><span className="min-w-0 flex-1 break-words">{t(`categoryTree.${op.kind}`)} · {op.sourceIds.map(label).join(' + ')}{op.sourceIds.length ? ' → ' : ''}{op.name}</span><span className="text-xs text-muted-foreground">{t(`aiOrganization.status.${op.status}`)}</span>{op.status === 'success' && <Button size="sm" variant="outline" disabled={c.busy || c.readonly} onClick={() => void c.restoreStructure(op.id)}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{t('aiOrganization.restore')}</Button>}</div>)}
    <div className="divide-y">{draft?.entries.map(entry => <article key={entry.repositoryId} data-organization-repository={entry.repositoryId} className="flex min-w-0 items-start gap-3 py-3"><div className="min-w-0 flex-1"><h3 className="break-all text-sm font-medium">{byId.get(entry.repositoryId)?.full_name ?? entry.repositoryId}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{label(entry.before.categoryId)} <ArrowRight className="mx-1 inline h-3 w-3" /> {label(entry.categoryId)}</p><details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">{t('dualOrganization.evidence')}</summary><p className="mt-2 break-words">{entry.reason}</p></details></div><span className="text-xs text-muted-foreground">{t(`aiOrganization.status.${entry.status === 'pending' ? entry.disposition : entry.status}`)}</span></article>)}</div>
  </section>;
}
