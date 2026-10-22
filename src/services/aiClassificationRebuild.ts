import type { ClassificationSchemeId } from '../types/classification';
import { useAppStore } from '../store/useAppStore';
import { classificationMembership, classificationStructure } from '../store/helpers/classificationSchemes';
import { normalizeOrder, organizationCategories } from '../store/helpers/repositoryOrganization';
import type { AppStoreState } from '../store/types';
import { AI_CLASSIFICATION_VERSION, buildAIClassification, classificationSourceFingerprint, refineClassificationGroup } from './classificationEngine';
import { syncAIClassification } from './classificationSync';
import { classificationSchemeSchema, repositoryClassificationInsightsSchema } from './classificationSchema';
import { classificationChangeStats } from './classificationStats';
export { AI_CLASSIFICATION_VERSION, buildAIClassification, classificationSourceFingerprint, classificationReport } from './classificationEngine';

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let rerun = false;
let forceRerun = false;
let queueOwner = '';
let overwriteLocks = false;
const queued = new Set<number>();

/** Automatic refreshes retain locked owners, their names, and valid parent references. */
function preserveLockedMemberships(next: Parameters<AppStoreState['replaceAIClassification']>[0], state: AppStoreState) {
  for (const schemeId of ['purpose', 'technology'] as const) {
    const previous = classificationStructure(state, schemeId);
    const categories = organizationCategories({ ...previous, language: state.language, classificationContext: schemeId });
    const scheme = next[schemeId];
    for (const repository of state.repositories) {
      const member = classificationMembership(repository, schemeId);
      if (!member.locked) continue;
      const generated = next.assignments[String(repository.id)][schemeId];
      if (generated.categoryId !== member.categoryId || generated.subcategoryId !== member.subcategoryId) {
        // New evidence cannot explain a deliberately retained, different assignment.
        if (next.insights?.[String(repository.id)]) delete next.insights[String(repository.id)][schemeId];
      }
      next.assignments[String(repository.id)][schemeId] = { ...member };
      if (!member.categoryId) continue;
      const category = categories.find(item => item.id === member.categoryId);
      if (!category) throw new Error('Locked classification category is missing');
      if (previous.customCategories.some(item => item.id === category.id)) {
        scheme.customCategories = [...scheme.customCategories.filter(item => item.id !== category.id), category];
      } else if (schemeId === 'purpose' && previous.defaultCategoryOverrides[category.id]) {
        scheme.defaultCategoryOverrides[category.id] = previous.defaultCategoryOverrides[category.id];
      }
      if (member.subcategoryId) {
        const group = previous.subcategories.find(item => item.id === member.subcategoryId && item.parentId === member.categoryId);
        if (!group) throw new Error('Locked classification subgroup is missing');
        scheme.subcategories = [...scheme.subcategories.filter(item => item.id !== group.id), group];
      }
    }
    const members = Object.values(next.assignments).map(row => row[schemeId]);
    const categoryIds = new Set(members.map(member => member.categoryId));
    const subgroupIds = new Set(members.map(member => member.subcategoryId));
    scheme.customCategories = scheme.customCategories.filter(item => categoryIds.has(item.id));
    scheme.subcategories = scheme.subcategories.filter(item => subgroupIds.has(item.id));
    scheme.categoryOrder = normalizeOrder(scheme.categoryOrder, [...categoryIds].filter((id): id is string => !!id));
    scheme.subcategoryOrder = normalizeOrder(scheme.subcategoryOrder, scheme.subcategories.map(item => item.id));
  }
}

export function enqueueAIClassificationRebuild(repositoryIds: number[] = [], options: { force?: boolean; overwriteLocks?: boolean } = {}): void {
  const getState = (useAppStore as typeof useAppStore & { getState?: typeof useAppStore.getState }).getState;
  if (typeof getState !== 'function') return;
  const state = getState();
  if (!state.user || !state.repositories.length || typeof state.setClassificationGeneration !== 'function') return;
  const owner = String(state.user.id);
  if (queueOwner !== owner) {
    queued.clear(); if (timer) clearTimeout(timer); timer = null; queueOwner = owner; forceRerun = false; rerun = false; overwriteLocks = false;
  }
  const generation = state.classificationSchemes?.generation;
  if (!options.force && generation?.sourceFingerprint === classificationSourceFingerprint(state.repositories) && generation.status !== 'failed') return;
  overwriteLocks ||= !!options.overwriteLocks;
  repositoryIds.forEach(id => queued.add(id));
  // Repeated render/subscription observations do not keep resetting the timer.
  if (running) { rerun = true; forceRerun ||= !!options.force; return; }
  state.setClassificationGeneration({ status: 'stale', algorithmVersion: AI_CLASSIFICATION_VERSION, queuedRepositoryIds: [...queued].sort((a, b) => a - b), error: undefined });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (owner !== String(useAppStore.getState().user?.id ?? '')) { queued.clear(); return; }
    void flushAIClassificationRebuild();
  }, 800);
}

export async function flushAIClassificationRebuild(): Promise<boolean> {
  if (running) { rerun = true; return false; }
  if (timer) { clearTimeout(timer); timer = null; }
  const state = useAppStore.getState();
  if (!state.user || !state.repositories.length) return false;
  const owner = String(state.user.id);
  const allowOverwriteLocks = queueOwner === owner && overwriteLocks;
  overwriteLocks = false;
  queueOwner = owner; running = true; queued.clear();
  state.setClassificationGeneration({ status: 'running', queuedRepositoryIds: [], algorithmVersion: AI_CLASSIFICATION_VERSION, error: undefined });
  try {
    const next = buildAIClassification(state.repositories, state.language);
    if (!allowOverwriteLocks) preserveLockedMemberships(next, state);
    if (String(useAppStore.getState().user?.id ?? '') !== owner) return false;
    // Validation and both scheme assignments commit in one store mutation.
    useAppStore.getState().replaceAIClassification(next);
    useAppStore.getState().setClassificationGeneration({ algorithmVersion: AI_CLASSIFICATION_VERSION });
    await syncAIClassification().catch(() => { /* Delivery state is reported separately; the local result remains valid. */ });
    return true;
  } catch (error) {
    if (String(useAppStore.getState().user?.id ?? '') === owner) {
      const generation = useAppStore.getState().classificationSchemes?.generation;
      // A delivery failure never rolls back an already committed classification.
      if (generation?.status !== 'ready') useAppStore.getState().setClassificationGeneration({ status: 'failed', error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) });
    }
    return false;
  } finally {
    running = false;
    if (rerun) {
      const force = forceRerun; rerun = false; forceRerun = false;
      if (queueOwner === String(useAppStore.getState().user?.id ?? '')) enqueueAIClassificationRebuild([...queued], { force });
      else queued.clear();
    }
  }
}

export async function refineAIClassification(schemeId: ClassificationSchemeId, subcategoryId: string): Promise<{ changed: boolean; reason: string }> {
  const state = useAppStore.getState();
  const zh = state.language.startsWith('zh');
  if (!state.user || running) return { changed: false, reason: zh ? '分类正在更新，请稍后再试。' : 'Classification is updating; try again shortly.' };
  const structure = classificationStructure(state, schemeId);
  const group = structure.subcategories.find(item => item.id === subcategoryId);
  if (!group) return { changed: false, reason: zh ? '该分类已变更，请重新选择。' : 'The group has changed. Select it again.' };
  const members = state.repositories.filter(repo => schemeId === 'purpose' ? repo.category_id === group.parentId && repo.subcategory_id === group.id : repo.classifications?.technology?.categoryId === group.parentId && repo.classifications.technology.subcategoryId === group.id);
  const result = refineClassificationGroup(members, schemeId, group, state.language);
  if (!result.changed) return { changed: false, reason: result.reason };
  const changes = new Map(result.rows.map(row => [row.repository.id, row.result]));
  const repositories = state.repositories.map(repo => {
    const next = changes.get(repo.id);
    if (!next) return repo;
    return { ...repo, ...(schemeId === 'purpose' ? { category_id: next.membership.categoryId, subcategory_id: next.membership.subcategoryId } : { classifications: { ...repo.classifications, technology: next.membership } }),
      classificationInsights: { ...repo.classificationInsights, [schemeId]: next.insight } };
  });
  // Existing semantic siblings are reused, including their manual names/order.
  const siblings = new Set(structure.subcategories.filter(item => item.id !== group.id).map(item => item.id));
  const inserted = result.groups.filter(item => !siblings.has(item.id));
  const subcategories = structure.subcategories.flatMap(item => item.id === group.id ? inserted : [item]);
  const subcategoryOrder = [...new Set(structure.subcategoryOrder.flatMap(id => id === group.id ? inserted.map(item => item.id) : [id]))];
  const nextStructure = { ...structure, subcategories, subcategoryOrder };
  classificationSchemeSchema.parse(nextStructure);
  for (const row of result.rows) {
    if (!subcategories.some(item => item.id === row.result.membership.subcategoryId && item.parentId === row.result.membership.categoryId)) throw new Error('Invalid refinement membership');
    repositoryClassificationInsightsSchema.parse({ [schemeId]: row.result.insight });
  }
  const byId = new Map(repositories.map(repo => [repo.id, repo]));
  const replace = (list: typeof repositories) => list.map(repo => byId.get(repo.id) ?? repo);
  const navigation = state.classificationNavigation?.[schemeId] ?? { selected: 'all', expanded: [] };
  const currentSelected = schemeId === 'purpose' ? state.selectedCategory : navigation.selected;
  const selected = currentSelected === group.id && !result.groups.some(item => item.id === group.id) ? group.parentId : currentSelected;
  useAppStore.setState({ repositories, searchResults: replace(state.searchResults),
    similarView: state.similarView ? { ...state.similarView, similarResults: replace(state.similarView.similarResults), originalSearchResults: replace(state.similarView.originalSearchResults) } : null,
    ...(schemeId === 'purpose' ? { subcategories, subcategoryOrder, selectedCategory: state.selectedCategory === group.id ? selected : state.selectedCategory } : {}),
    classificationSchemes: { ...state.classificationSchemes, [schemeId]: nextStructure,
      generation: { status: 'ready', generation: (state.classificationSchemes?.generation?.generation ?? 0) + 1, queuedRepositoryIds: [], repositoryIds: repositories.map(repo => repo.id), lastGeneratedAt: new Date().toISOString(), sourceFingerprint: classificationSourceFingerprint(repositories), algorithmVersion: AI_CLASSIFICATION_VERSION,
        lastChange: { ...state.classificationSchemes?.generation?.lastChange, [schemeId]: classificationChangeStats(state.repositories, repositories, schemeId) } } },
    classificationNavigation: { ...state.classificationNavigation, [schemeId]: { ...navigation, selected } },
  });
  await syncAIClassification().catch(() => { /* Keep successful local refinement when offline. */ });
  return { changed: true, reason: result.reason };
}
