import { z } from 'zod';
import type { OrganizationDraft, OrganizationRunProgress } from '../types/aiOrganization';
import type { ClassificationSchemeId } from '../types/classification';
import { parseOrganizationJSON } from './aiOrganizationService';
import { parseOrganizationTaxonomy } from './aiOrganizationTaxonomy';
import { organizationWorkers } from './aiOrganizationScheduling';
import { organizationRunEvents } from './aiOrganizationRunEvents';

export const organizationHash = async (value: unknown) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};
export async function planOrganizationStructure(input: { draft: OrganizationDraft; proposalId: string; signal: AbortSignal;
  concurrency: number; progress: OrganizationRunProgress; targets: ClassificationSchemeId[]; quick: boolean;
  request: (key: string, user: unknown, ids?: number[], maxTokens?: number) => Promise<string>; publish: () => Promise<void>;
  check: () => void; recordError: (stage: string, ids: number[], error: unknown) => void; onFailure?: (error: unknown) => void; }) {
  const { draft, targets, check, request, publish, signal, progress } = input; const dual = draft.dual!;
  const changed = new Set<ClassificationSchemeId>();
  if (!targets.length) return changed;
  const inventory = dual.understanding.map(row => ({ repositoryId: row.repositoryId, status: row.status,
    purpose: row.purpose.slice(0, 3).map(value => value.slice(0, 220)), technology: row.technology.slice(0, 3).map(value => value.slice(0, 160)),
    ...(input.quick && row.status === 'pending' ? { name: row.sourceMetadata.name, description: row.sourceMetadata.description.slice(0, 350), summary: row.sourceMetadata.summary.slice(0, 350), tags: row.sourceMetadata.tags.slice(0, 8) } : {}) }));
  let summaries: unknown[] = inventory;
  if (JSON.stringify(inventory).length > 24000) {
    const chunks: typeof inventory[] = []; let chunk: typeof inventory = []; let length = 0;
    for (const record of inventory) {
      const size = JSON.stringify(record).length;
      if (chunk.length && length + size > 12000) { chunks.push(chunk); chunk = []; length = 0; }
      chunk.push(record); length += size;
    }
    if (chunk.length) chunks.push(chunk);
    Object.assign(progress, { summaryLevel: 0, summaryCompleted: 0, summaryFallback: 0, summaryTotal: chunks.length }); await publish();
    summaries = new Array(chunks.length);
    await organizationWorkers(chunks.map((records, index) => ({ records, index })), input.concurrency, signal, async ({ records, index }) => {
      const key = `summary:v2:${index}`; const inputHash = await organizationHash(['compact-inventory-v2', dual.execution?.configIdentity, records]); check();
      const cached = dual.summaries.find(row => row.inputHash === inputHash);
      if (cached) { summaries[index] = { purpose: cached.purpose, technology: cached.technology }; progress.summaryCompleted!++; await publish(); return; }
      let repair: string | undefined;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const raw = await request(key, { task: 'Summarize ALL supplied records into {"purpose":"compact use-case inventory","technology":"compact technical inventory"}. Each field at most 600 characters. Preserve distinct minority domains and uncertainty. No per-repository enumeration and no invented facts. Return only JSON.', records, repair }, [], 1600);
          try {
            const parsed = z.object({ purpose: z.string().min(1).max(600), technology: z.string().min(1).max(600) }).strict().parse(parseOrganizationJSON(raw));
            check(); summaries[index] = parsed;
            dual.summaries = dual.summaries.filter(row => row.inputHash !== inputHash);
            dual.summaries.push({ repositoryIds: records.map(row => row.repositoryId), ...parsed, inputHash, level: 0, index });
            organizationRunEvents.validation(input.proposalId, key); progress.summaryCompleted!++; await publish(); return;
          } catch (error) { organizationRunEvents.validation(input.proposalId, key, error); repair = String(error).slice(0, 1800); if (attempt) throw error; }
        }
      } catch (error) {
        input.recordError('summary', records.map(row => row.repositoryId), error);
        // Keep the entire compact chunk as fallback, never silently omit its domains.
        summaries[index] = { records, summaryUnavailable: true };
        progress.summaryFallback!++;
      }
      await publish();
    }, input.onFailure);
  }
  await organizationWorkers(targets, input.concurrency, signal, async schemeId => {
    const scheme = dual.schemes[schemeId]; const key = `structure:${schemeId}`;
    if (!inventory.some(row => row.status === 'understood' || input.quick && row.status === 'pending')) {
      input.recordError(key, draft.scope.repositoryIds, new Error('No usable repository evidence')); return;
    }
    try {
      if (JSON.stringify(summaries).length > 48000) throw new Error('Unresolved summary chunks exceed planning budget; retry failed summaries before designing this scheme');
      let repair: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await request(key, { task: 'Design a coherent TWO-LEVEL classification covering the FULL inventory. Return {"categories":[{"ref":"existing ID or unique temporary ref","name":"name","parentRef":null or parent ref}]}. Prefer a SMALL set of clear everyday main categories and meaningful subgroups. No language-only or one-project categories unless justified. Reuse suitable existing IDs/names; use new refs for renamed concepts. No third level, no empty result. Metadata-only and stale evidence is uncertain, not proof of capabilities.', schemeId, instruction: draft.instruction, maxNewSubcategories: draft.maxNewSubcategories, existing: scheme.categories, summaries, repair });
        try {
          const target = parseOrganizationTaxonomy(raw, scheme, draft.maxNewSubcategories); check();
          scheme.proposedCategoryIds = target.map(row => row.id); scheme.retireCategoryIds = [];
          scheme.categories = [...scheme.categories, ...target.filter(row => !scheme.categories.some(old => old.id === row.id))];
          scheme.ready = true; changed.add(schemeId); organizationRunEvents.validation(input.proposalId, key); break;
        } catch (error) { organizationRunEvents.validation(input.proposalId, key, error); repair = String(error).slice(0, 1800); if (attempt) throw error; }
      }
    } catch (error) { input.recordError(key, draft.scope.repositoryIds, error); scheme.ready = false; }
    await publish();
  }, input.onFailure);
  return changed;
}
