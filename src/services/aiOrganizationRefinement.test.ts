import { describe, expect, it, vi } from 'vitest';
vi.unmock('../store/useAppStore');
import { refineOrganizationDraft } from './aiOrganizationRefinement';
import { createDualOrganizationDraft } from './aiOrganizationDual';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';
import type { WorkbenchProposal } from '../types/aiWorkbench';
import { organizationDraftSchema } from './aiOrganizationSchema';

function fixture() {
  const repo = { id: 991, name: 'fixture', full_name: 'fixture/tool', pushed_at: '2026-10-06', topics: [] } as unknown as Repository;
  const draft = createDualOrganizationDraft({ repositories: [repo], instruction: 'Few clear categories', scopeName: 'all', configId: 'fixture' });
  draft.status = 'ready'; const scheme = draft.dual!.schemes.purpose;
  scheme.categories.push({ id: 'writing', name: 'Writing', parentId: null, icon: 'folder', isNew: true });
  scheme.ready = true; scheme.proposedCategoryIds = ['writing'];
  Object.assign(scheme.entries[0], { categoryId: 'writing', disposition: 'move', selected: true, reason: 'Writing tools' });
  const now = new Date().toISOString();
  return { id: 'fixture-draft', sessionId: 'fixture-session', ownerId: '991', operations: [], createdAt: now, updatedAt: now, organization: draft } satisfies WorkbenchProposal;
}
const adjustment = { categories: [{ ref: 'apps', name: 'AI Apps', parentRef: null }], moves: [{ sourceId: 'writing', targetRef: 'apps', subgroupRef: null, reason: 'Combine requested AI applications' }], renames: [] };
describe('local draft refinement', () => {
  it('creates a new revision and preserves the other scheme and live Store', () => {
    const original = fixture(); const before = useAppStore.getState();
    const next = refineOrganizationDraft(original, 'purpose', adjustment);
    expect(next.id).not.toBe(original.id); expect(next.organization!.revision).toBe(original.organization.revision + 1);
    expect(next.organization!.dual!.schemes.technology).toEqual(original.organization.dual!.schemes.technology);
    expect(original.organization.dual!.schemes.purpose.entries[0].categoryId).toBe('writing');
    expect(useAppStore.getState()).toBe(before); organizationDraftSchema.parse(next.organization);
  });
  it('does not overwrite manual targets or save an empty adjustment', () => {
    const original = fixture(); original.organization.dual!.schemes.purpose.entries[0].manual = true;
    expect(() => refineOrganizationDraft(original, 'purpose', adjustment)).toThrow('No valid local changes');
  });
  it('rejects invented sources before changing the draft', () => {
    const original = fixture();
    expect(() => refineOrganizationDraft(original, 'purpose', { ...adjustment, moves: [{ ...adjustment.moves[0], sourceId: 'invented' }] })).toThrow('Invalid or duplicate');
    expect(original.organization.dual!.schemes.purpose.entries[0].categoryId).toBe('writing');
  });
});
