import type { OrganizationCategory, OrganizationSchemeDraft } from '../../types/aiOrganization';

export function categorySubgroupLabel(category: OrganizationCategory, scheme?: OrganizationSchemeDraft) {
  if (!category.parentId || !scheme?.categories.some(other => other.id !== category.id && other.parentId === category.parentId && other.name.trim().toLocaleLowerCase() === category.name.trim().toLocaleLowerCase())) return category.name;
  const merge = scheme.structureOperations?.find(op => op.kind === 'merge' && ['pending', 'conflict'].includes(op.status) && op.targetId === category.parentId);
  const original = merge?.categoriesBefore.find(old => old.id === category.id);
  const source = merge?.categoriesBefore.find(old => old.id === original?.parentId);
  return source ? `${category.name} (${source.name})` : category.name;
}

export function categoryTreeIssueKey(message: string): string | null {
  if (/authorize locked|requires explicit confirmation/i.test(message)) return 'categoryTree.issues.locked';
  if (/duplicate subgroup/i.test(message)) return 'categoryTree.issues.subgroupName';
  if (/duplicate category|category with that name/i.test(message)) return 'categoryTree.issues.categoryName';
  if (/membership changed|confirmation is stale/i.test(message)) return 'categoryTree.issues.membership';
  if (/category structure changed|definitions.*changed/i.test(message)) return 'categoryTree.issues.structure';
  if (/resolve all.*targets|invalid subgroup mapping/i.test(message)) return 'categoryTree.issues.targets';
  if (/repository.*changed/i.test(message)) return 'categoryTree.issues.repository';
  if (/dependent merge/i.test(message)) return 'categoryTree.issues.dependency';
  return null;
}
