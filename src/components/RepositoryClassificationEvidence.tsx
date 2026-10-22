import type { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';
import { classificationPurposeMembership } from '../store/helpers/classificationSchemes';
import { getAllCategories } from '../store/helpers/categoryHelpers';
import { repositoryClassificationInsight } from '../utils/classificationFacets';

/** Present the saved classifier result alongside its actual category names. */
export function RepositoryClassificationEvidence({ repository, compact = false }: { repository: Repository; compact?: boolean }) {
  const language = useAppStore(state => state.language);
  const purposeCategories = useAppStore(state => state.customCategories ?? []);
  const overrides = useAppStore(state => state.defaultCategoryOverrides);
  const purposeGroups = useAppStore(state => state.subcategories ?? []);
  const technology = useAppStore(state => state.classificationSchemes?.technology);
  const zh = language.startsWith('zh');
  const purpose = classificationPurposeMembership(repository);
  const rows = (['purpose', 'technology'] as const).flatMap(id => {
    const member = id === 'purpose' ? purpose : repository.classifications?.technology;
    if (!member?.categoryId) return [];
    const categories = id === 'purpose' ? getAllCategories(purposeCategories, language, [], overrides) : technology?.customCategories ?? [];
    const groups = id === 'purpose' ? purposeGroups : technology?.subcategories ?? [];
    const category = categories.find(category => category.id === member.categoryId);
    if (!category) return [];
    const group = groups.find(group => group.id === member.subcategoryId && group.parentId === category.id);
    const insight = repositoryClassificationInsight(repository, id);
    return [{ id, label: id === 'purpose' ? (zh ? '用途' : 'Purpose') : (zh ? '技术' : 'Technology'), name: [category.name, group?.name].filter(Boolean).join(' / '), shortName: group?.name || category.name, insight }];
  });
  if (!rows.length) return null;
  return <div className={compact ? 'mb-2 flex flex-wrap items-center gap-1.5 text-[11px]' : 'space-y-3'} aria-label={zh ? '仓库分类依据' : 'Repository classification evidence'}>
    {rows.map(row => <div key={row.id} className={compact ? 'inline-flex flex-wrap items-center gap-1' : 'space-y-1'}>
      <span className="rounded border border-border px-2 py-0.5 text-xs" title={`${row.label}: ${row.name}`}>{row.label}: {compact ? row.shortName : row.name}</span>
      {!compact && row.insight && (row.insight.evidence.length > 0 || row.insight.refinementReason || row.insight.facets.length > 0) && <details className="pt-1">
        <summary className="cursor-pointer text-xs text-muted-foreground">{zh ? '分类依据与特征' : 'Classification evidence and facets'}</summary>
        <div className="mt-2 space-y-2">
        {!!row.insight.evidence.length && <ul className="list-inside list-disc text-xs text-muted-foreground">{row.insight.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul>}
        {row.insight.refinementReason && <p className="text-xs text-muted-foreground">{row.insight.refinementReason}</p>}
        {!!row.insight.facets.length && <div className="flex flex-wrap gap-1">{row.insight.facets.map(facet => <span key={facet.id} className="rounded border px-2 py-0.5 text-xs" title={facet.evidence.join(' · ')}>{facet.label}</span>)}</div>}
        </div>
      </details>}
    </div>)}
  </div>;
}
