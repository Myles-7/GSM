import { z } from 'zod';
import type { OrganizationDraft, OrganizationUnderstanding } from '../types/aiOrganization';
import type { ClassificationSchemeId } from '../types/classification';
import { collectOrganizationRows } from './aiOrganizationReliability';
import { organizationWorkers } from './aiOrganizationScheduling';
import { ORGANIZATION_SCHEMES } from './aiOrganizationTaxonomy';
import { organizationHash } from './aiOrganizationPlanning';
import { organizationRunEvents } from './aiOrganizationRunEvents';

const fact = z.object({ status: z.enum(['understood', 'insufficient']), purpose: z.array(z.string().trim().min(1).max(2000)).max(12),
  technology: z.array(z.string().trim().min(1).max(2000)).max(12) }).strict().refine(row => row.status !== 'understood' || row.purpose.length > 0);
const resultRow = z.object({ repositoryId: z.number().int().positive(), schemeId: z.enum(['purpose', 'technology']), categoryId: z.string().nullable(),
  subcategoryId: z.string().nullable(), disposition: z.enum(['move', 'unchanged', 'insufficient']), reason: z.string().trim().min(1).max(2000), understanding: fact.optional() }).strict();

export async function assignOrganizationRepositories(input: { draft: OrganizationDraft; proposalId: string; signal: AbortSignal;
  concurrency: number; quick: boolean; retryOnly?: boolean; selectedIds?: Set<number>; changed: Set<ClassificationSchemeId>;
  previousConfigIdentity?: string; forceVerification?: boolean;
  evidence: Map<number, string>; request: (key: string, user: unknown, ids?: number[], maxTokens?: number) => Promise<string>;
  publish: () => Promise<void>; check: () => void; recordError: (stage: string, ids: number[], error: unknown) => void;
  saveFact: (row: OrganizationUnderstanding) => Promise<void>; enrich: (row: OrganizationUnderstanding) => Promise<boolean>; onFailure?: (error: unknown) => void;
}) {
  const { draft, signal, request, check, publish, selectedIds } = input; const dual = draft.dual!;
  const facts = new Map(dual.understanding.map(row => [row.repositoryId, row]));
  const references = Object.fromEntries(ORGANIZATION_SCHEMES.map(id => [id, new Map(dual.schemes[id].categories.map((c, index) => [c.id, `${id[0]}${index + 1}`]))])) as Record<ClassificationSchemeId, Map<string, string>>;
  const actualIds = Object.fromEntries(ORGANIZATION_SCHEMES.map(id => [id, new Map([...references[id]].map(([actual, ref]) => [ref, actual]))])) as Record<ClassificationSchemeId, Map<string, string>>;
  const excerpt = (values: string[]) => values.slice(0, 4).map(value => value.slice(0, 180));
  const contexts = new Map<ClassificationSchemeId, string>();
  const legacyContexts = new Map<ClassificationSchemeId, string>();
  for (const id of ORGANIZATION_SCHEMES) {
    contexts.set(id, await organizationHash([draft.instruction, dual.schemes[id].categories, dual.schemes[id].proposedCategoryIds]));
    legacyContexts.set(id, await organizationHash([input.previousConfigIdentity, draft.instruction, dual.schemes[id].categories, dual.schemes[id].proposedCategoryIds]));
  }
  const hashes = new Map<string, string>();
  for (const schemeId of ORGANIZATION_SCHEMES) for (const entry of dual.schemes[schemeId].entries) {
    const hash = await organizationHash([facts.get(entry.repositoryId)!.fingerprint, contexts.get(schemeId)]);
    const legacyHash = await organizationHash([facts.get(entry.repositoryId)!.fingerprint, legacyContexts.get(schemeId)]);
    if (!entry.manual && entry.verification === 'verified' && input.previousConfigIdentity && entry.verificationHash === legacyHash && !input.changed.has(schemeId)) entry.verificationHash = hash;
    hashes.set(`${schemeId}:${entry.repositoryId}`, hash);
    if (!entry.manual && (entry.verificationHash !== hash || input.changed.has(schemeId))) {
      entry.verification = 'pending'; entry.selected = false;
    }
  }
  const fail = (schemeId: ClassificationSchemeId, id: number, message: string) => {
    const entry = dual.schemes[schemeId].entries.find(row => row.repositoryId === id)!; if (entry.manual) return;
    Object.assign(entry, { categoryId: entry.before.categoryId, subcategoryId: entry.before.subcategoryId, selected: false, disposition: 'insufficient',
      verification: 'failed', reason: message, error: message });
  };
  for (const schemeId of ORGANIZATION_SCHEMES) for (const entry of dual.schemes[schemeId].entries) {
    if (selectedIds && !selectedIds.has(entry.repositoryId)) continue;
    const row = facts.get(entry.repositoryId)!;
    if (!dual.schemes[schemeId].ready || !(row.status === 'understood' || input.quick && row.status === 'pending')) {
      fail(schemeId, row.repositoryId, row.error ?? dual.errors.find(error => error.stage === `structure:${schemeId}`)?.message ?? 'Insufficient evidence to classify');
    }
  }
  await publish();
  await organizationWorkers(draft.batches.map((batch, index) => ({ batch, index })), input.concurrency, signal, async ({ batch, index }) => {
    const pairs = batch.repositoryIds.flatMap(id => ORGANIZATION_SCHEMES.filter(schemeId => {
      const scheme = dual.schemes[schemeId]; const entry = scheme.entries.find(row => row.repositoryId === id)!; const row = facts.get(id)!;
      return (!selectedIds || selectedIds.has(id)) && scheme.ready && !entry.manual &&
        (row.status === 'understood' || input.quick && row.status === 'pending') &&
        (!input.retryOnly || input.forceVerification && selectedIds || input.changed.has(schemeId) || entry.verification !== 'verified');
    }).map(schemeId => ({ id, schemeId, pairId: id * 2 + Number(schemeId === 'technology') })));
    if (!pairs.length) return;
    const map = new Map(pairs.map(pair => [pair.pairId, pair])); const key = `assignments:both:${index}`;
    const committedFacts = new Map<number, string>();
    const payload = (missing: number[], repair?: string) => {
      const targets = missing.map(id => map.get(id)!);
      return { task: 'Assign each requested repository/scheme pair. Categories are tuples [id,name,parentId]; null parent means main. JSON only: {"results":[{"repositoryId":123,"schemeId":"purpose","categoryId":"p1","subcategoryId":null,"disposition":"move","reason":"brief factual reason"}]}. schemeId: purpose|technology; disposition: move|unchanged|insufficient. Use supplied IDs; prefer proposedCategoryIds. Unknown facts stay unknown. Unchanged/insufficient retain before. For needsUnderstanding=true, add understanding:{status:"understood|insufficient",purpose:["uses"],technology:["facts"]}, identical for both schemes. No other fields.',
        repair, instruction: draft.instruction,
        schemes: Object.fromEntries(ORGANIZATION_SCHEMES.map(id => {
          const scheme = dual.schemes[id];
          const included = new Set(scheme.proposedCategoryIds ?? scheme.categories.map(c => c.id));
          for (const target of targets.filter(t => t.schemeId === id)) {
            const before = scheme.entries.find(e => e.repositoryId === target.id)!.before;
            if (before.categoryId) included.add(before.categoryId);
            if (before.subcategoryId) included.add(before.subcategoryId);
          }
          for (const c of scheme.categories) if (included.has(c.id) && c.parentId) included.add(c.parentId);
          return [id, { categories: scheme.categories.filter(c => included.has(c.id)).map(c => [references[id].get(c.id), c.name, c.parentId ? references[id].get(c.parentId) : null]),
            proposedCategoryIds: scheme.proposedCategoryIds?.map(c => references[id].get(c)) }];
        })),
        repositories: [...new Set(targets.map(t => t.id))].map(id => {
          const f = facts.get(id)!;
          return { repositoryId: id, purpose: excerpt(f.purpose), technology: excerpt(f.technology), staleAnalysis: f.staleAnalysis,
            needsUnderstanding: f.status === 'pending', ...(f.status === 'pending' ? { metadata: f.sourceMetadata, evidence: input.evidence.get(id)?.slice(0, 4000) } : {}),
            targets: targets.filter(t => t.id === id).map(t => {
              const before = dual.schemes[t.schemeId].entries.find(e => e.repositoryId === id)!.before;
              return { schemeId: t.schemeId, before: { categoryId: before.categoryId ? references[t.schemeId].get(before.categoryId) : null, subcategoryId: before.subcategoryId ? references[t.schemeId].get(before.subcategoryId) : null } };
            }) };
        }) };
    };
    const execute = async (pairIds: number[]) => collectOrganizationRows({ ids: pairIds, signal,
      onValidation: error => organizationRunEvents.validation(input.proposalId, key, error),
      request: (missing, repair) => {
        const targets = missing.map(id => map.get(id)!);
        return request(key, payload(missing, repair), [...new Set(targets.map(target => target.id))], 3200);
      },
      parse: raw => {
        const row = resultRow.parse(raw);
        if (row.categoryId) row.categoryId = actualIds[row.schemeId].get(row.categoryId) ?? row.categoryId;
        if (row.subcategoryId) row.subcategoryId = actualIds[row.schemeId].get(row.subcategoryId) ?? row.subcategoryId;
        const scheme = dual.schemes[row.schemeId]; const entry = scheme.entries.find(e => e.repositoryId === row.repositoryId);
        if (!entry || row.categoryId && !scheme.categories.some(c => c.id === row.categoryId && !c.parentId)) throw new Error('Invalid main target');
        if (row.disposition !== 'insufficient' && !row.categoryId) throw new Error('Classification requires a valid main target');
        if (row.subcategoryId && !scheme.categories.some(c => c.id === row.subcategoryId && c.parentId === row.categoryId)) throw new Error('Invalid subgroup');
        if (entry.preserveMain && row.categoryId !== entry.before.categoryId) throw new Error('Fixed main target changed');
        if (row.disposition !== 'move' && (row.categoryId !== entry.before.categoryId || row.subcategoryId !== entry.before.subcategoryId)) throw new Error('Unresolved membership must remain unchanged');
        if (facts.get(row.repositoryId)?.status === 'pending' && !row.understanding) throw new Error('Missing repository understanding');
        if (row.understanding && committedFacts.has(row.repositoryId) && committedFacts.get(row.repositoryId) !== JSON.stringify(row.understanding)) throw new Error('Conflicting understanding between schemes');
        if (row.understanding?.status === 'insufficient' && row.disposition !== 'insufficient') throw new Error('Insufficient evidence cannot select a target');
        return { id: row.repositoryId * 2 + Number(row.schemeId === 'technology'), value: row };
      },
      onRows: async rows => {
        check(); const updated = new Set<number>();
        for (const row of rows.values()) {
          const understanding = facts.get(row.repositoryId)!;
          if (row.understanding && understanding.status === 'pending' && !updated.has(row.repositoryId)) {
            const peers = [...rows.values()].filter(peer => peer.repositoryId === row.repositoryId && peer.understanding);
            if (peers.some(peer => JSON.stringify(peer.understanding) !== JSON.stringify(row.understanding))) {
              for (const peer of peers) fail(peer.schemeId, peer.repositoryId, 'Conflicting understanding between schemes'); continue;
            }
            Object.assign(understanding, row.understanding, { understoodAt: new Date().toISOString() }); delete understanding.error; updated.add(row.repositoryId);
            committedFacts.set(row.repositoryId, JSON.stringify(row.understanding));
            await input.saveFact(understanding); check();
          }
          const entry = dual.schemes[row.schemeId].entries.find(e => e.repositoryId === row.repositoryId)!;
          Object.assign(entry, { categoryId: row.categoryId, subcategoryId: row.subcategoryId, reason: row.reason, verification: 'verified', verificationHash: hashes.get(`${row.schemeId}:${row.repositoryId}`) });
          entry.disposition = row.disposition === 'insufficient' ? 'insufficient' : entry.categoryId === entry.before.categoryId && entry.subcategoryId === entry.before.subcategoryId ? 'unchanged' : 'move';
          entry.selected = entry.disposition === 'move' && (!entry.before.locked || entry.categoryId === entry.before.categoryId); delete entry.error;
        }
        await publish();
      },
    });
    try {
      // Respect the body budget independently of stored metadata-only batch sizes.
      const groups: number[][] = []; let group: number[] = [];
      for (const id of [...new Set(pairs.map(pair => pair.id))]) {
        // Missing evidence is a separate workload; do not stall already-understood peers.
        if (facts.get(id)!.status === 'pending' && input.evidence.has(id)) {
          if (group.length) groups.push(group);
          groups.push([id]); group = []; continue;
        }
        const candidate = [...group, id];
        const candidatePairs = pairs.filter(p => candidate.includes(p.id)).map(p => p.pairId);
        if (group.length && (candidate.length > 5 || JSON.stringify(payload(candidatePairs)).length > 8000)) { groups.push(group); group = []; }
        group.push(id);
      } if (group.length) groups.push(group);
      for (const group of groups) {
        const ids = pairs.filter(pair => group.includes(pair.id)).map(pair => pair.pairId); const result = await execute(ids); check();
        for (const [id, error] of result.errors) if (!result.rows.has(id)) { const pair = map.get(id)!; fail(pair.schemeId, pair.id, error); }
      }
      const uncertain = [...new Set(pairs.filter(pair => facts.get(pair.id)!.status === 'insufficient' && !facts.get(pair.id)!.deferred).map(pair => pair.id))];
      if (input.quick) for (const id of uncertain) {
        if (await input.enrich(facts.get(id)!)) {
          facts.get(id)!.status = 'pending';
          const result = await execute(pairs.filter(pair => pair.id === id).map(pair => pair.pairId)); check();
          for (const [pairId, error] of result.errors) if (!result.rows.has(pairId)) { const pair = map.get(pairId)!; fail(pair.schemeId, id, error); }
        }
      }
    } catch (error) {
      input.recordError('assignments', [...new Set(pairs.map(pair => pair.id))], error);
      for (const pair of pairs) if (dual.schemes[pair.schemeId].entries.find(entry => entry.repositoryId === pair.id)!.verification !== 'verified') fail(pair.schemeId, pair.id, error instanceof Error ? error.message : String(error));
    }
    for (const id of [...new Set(pairs.map(pair => pair.id))]) if (facts.get(id)!.status === 'pending') {
      facts.get(id)!.status = 'failed'; facts.get(id)!.error = 'No valid assignment and understanding result';
    }
    await publish();
  }, input.onFailure);
}
