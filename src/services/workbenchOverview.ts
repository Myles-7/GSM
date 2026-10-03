import { z } from 'zod';
import type { WorkbenchCandidate, WorkbenchRequirements } from '../types/aiWorkbench';
import type { AIService } from './aiService';
import { selectAnalysisContext } from './analysisContext';

export const mergeWorkbenchCandidates = (...collections: WorkbenchCandidate[][]): WorkbenchCandidate[] => {
  const merged = new Map<string, WorkbenchCandidate>();
  for (const collection of collections) for (const item of collection) {
    const key = item.repository.full_name.toLowerCase();
    const previous = merged.get(key);
    const sameMaterial = previous && JSON.stringify([previous.repository.description, previous.repository.ai_summary, previous.repository.topics, previous.repository.language])
      === JSON.stringify([item.repository.description, item.repository.ai_summary, item.repository.topics, item.repository.language]);
    merged.set(key, previous ? { ...previous, ...item,
      overview: item.overview ?? (sameMaterial ? previous.overview : undefined),
      reasons: [...new Set([...previous.reasons, ...item.reasons])],
      sources: [...new Set([...previous.sources, ...item.sources])],
    } : item);
  }
  return [...merged.values()];
};

export const sameWorkbenchRequirements = (a: WorkbenchRequirements, b: WorkbenchRequirements): boolean =>
  JSON.stringify([a.purpose.trim(), ...(['required', 'preferred', 'excluded'] as const).map(key => [...a[key]].sort())])
  === JSON.stringify([b.purpose.trim(), ...(['required', 'preferred', 'excluded'] as const).map(key => [...b[key]].sort())]);

export function workbenchOverviewMarkdown(candidates: WorkbenchCandidate[], title: string): string {
  const groups = new Map<string, WorkbenchCandidate[]>();
  candidates.forEach(item => {
    const group = item.overview?.category || '—';
    groups.set(group, [...(groups.get(group) ?? []), item]);
  });
  return `# ${title}\n\n` + [...groups].map(([name, items]) => `## ${name} (${items.length})\n\n` + items.map(item =>
    `- [${item.repository.full_name}](https://github.com/${item.repository.full_name}): ${item.overview?.summary || item.summary || item.repository.description || '—'}${item.overview?.status === 'failed' ? ' [pending]' : ''}`
  ).join('\n')).join('\n\n') + '\n';
}

const overviewSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  items: z.array(z.object({
    name: z.string().trim().min(1), summary: z.string().trim().min(1).max(220),
    category: z.string().trim().min(1).max(60), categoryDescription: z.string().trim().max(180),
    kind: z.enum(['tool', 'library', 'resource', 'other']), insufficient: z.boolean(),
  }).strict()).min(1).max(8),
}).strict();

export async function summarizeWorkbenchCandidates(input: {
  candidates: WorkbenchCandidate[]; requirements: WorkbenchRequirements; language: string;
  ai: Pick<AIService, 'generateChatText'>; concurrency: number; signal?: AbortSignal;
  readReadme?: (candidate: WorkbenchCandidate, signal?: AbortSignal) => Promise<string>;
  onUpdate: (candidates: WorkbenchCandidate[], summary: string) => Promise<void> | void;
}): Promise<WorkbenchCandidate[]> {
  const candidates = input.candidates.map(item => ({ ...item }));
  const pending = candidates.filter(item => !item.overview || item.overview.status === 'failed');
  const batches: WorkbenchCandidate[][] = [];
  let current: WorkbenchCandidate[] = [], size = 0;
  for (const item of pending) {
    const cost = Math.min(2_000, (item.repository.ai_summary || item.repository.description || item.summary).length) + 300;
    if (current.length && (current.length >= 8 || size + cost > 12_000)) { batches.push(current); current = []; size = 0; }
    current.push(item); size += cost;
  }
  if (current.length) batches.push(current);
  let next = 0, emission = Promise.resolve();
  const summaries: string[] = [];
  const known = [...new Set(candidates.map(item => item.overview?.category).filter(Boolean))];
  const emit = () => {
    emission = emission.then(async () => {
      input.signal?.throwIfAborted();
      await input.onUpdate(candidates.map(item => ({ ...item, overview: item.overview && { ...item.overview } })), summaries.join(' ').slice(0, 800));
    });
    return emission;
  };
  const worker = async () => {
    while (next < batches.length) {
      input.signal?.throwIfAborted();
      const batch = batches[next++];
      const basis = new Map<string, 'metadata' | 'existing' | 'readme'>();
      try {
        const materials = await Promise.all(batch.map(async item => {
          const r = item.repository;
          let text = r.ai_summary || (item.status === 'verified' ? item.summary : r.description) || '';
          basis.set(r.full_name, r.ai_summary || item.status === 'verified' ? 'existing' : 'metadata');
          if (text.trim().length < 40 && input.readReadme) {
            try {
              const readme = await input.readReadme(item, input.signal);
              if (readme.trim()) { text = selectAnalysisContext(readme, 1_400); basis.set(r.full_name, 'readme');
                item.sources = [...new Set([...item.sources, `https://github.com/${r.full_name}#readme`])]; }
            } catch { input.signal?.throwIfAborted(); }
          }
          return { name: r.full_name, description: text.slice(0, 2_000), topics: r.topics, language: r.language };
        }));
        input.signal?.throwIfAborted();
        const raw = await input.ai.generateChatText({
          system: [
            'Organize this batch of GitHub projects into a concise overview. Use only supplied material; do not research source code or invent capabilities.',
            'Return strict JSON: {"summary":"short batch overview","items":[{"name":"exact repository full_name","summary":"one sentence purpose","category":"usage category","categoryDescription":"short category meaning","kind":"tool|library|resource|other","insufficient":false}]} .',
            'Return exactly one item for every input name, no extra names. Awesome lists and directories are resource collections, not runnable tools.',
            'Group by practical purpose, reuse knownCategories where suitable, distinguish material insufficiency from poor relevance.',
            input.language.startsWith('zh') ? '面向用户的内容用简体中文。每项介绍目标30至70字，只说明是什么、主要做什么；资料不足则明确说明。分类名称简短，不添加推荐结论。' : 'Write user-facing text in English. Each purpose is one concise sentence; explicitly state insufficient material. No unsupported recommendations.',
          ].join('\n'),
          user: JSON.stringify({ purpose: input.requirements.purpose, knownCategories: known, projects: materials }),
          maxTokens: 2_800, temperature: 0.1, signal: input.signal,
        });
        input.signal?.throwIfAborted();
        const parsed = overviewSchema.parse(JSON.parse(raw));
        const names = new Set(batch.map(item => item.repository.full_name));
        if (parsed.items.length !== names.size || new Set(parsed.items.map(item => item.name)).size !== names.size
          || parsed.items.some(item => !names.has(item.name))) throw new Error('Overview repository coverage mismatch');
        for (const result of parsed.items) {
          const item = batch.find(candidate => candidate.repository.full_name === result.name)!;
          item.overview = { summary: result.summary, category: result.category, categoryDescription: result.categoryDescription,
            kind: result.kind, status: result.insufficient ? 'insufficient' : 'ready', basis: basis.get(result.name) ?? 'metadata' };
          if (!known.includes(result.category)) known.push(result.category);
        }
        summaries.push(parsed.summary);
      } catch (error) {
        input.signal?.throwIfAborted();
        batch.forEach(item => { item.overview = {
          summary: item.repository.ai_summary || item.repository.description || item.summary || '',
          category: '', categoryDescription: '', kind: 'other', status: 'failed', basis: basis.get(item.repository.full_name) ?? 'metadata',
          error: error instanceof Error ? error.message : String(error),
        }; });
      }
      await emit();
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, input.concurrency), batches.length) }, worker));
  input.signal?.throwIfAborted();
  return candidates;
}
