import { z } from 'zod';
import type { RepositoryDetailsAnalysis } from '../types/repositoryDetails';

export const repositoryDetailLimits = { text: 12000, tags: 10, platforms: 10, features: 30, scenarios: 30, quickstart: 20, software_forms: 7, deployment_modes: 4 } as const;
const text = z.string().trim().min(1).max(repositoryDetailLimits.text);
export const repositoryDetailContentSchema = z.object({
  summary: text.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(repositoryDetailLimits.tags).default([]),
  platforms: z.array(z.string().trim().min(1).max(40)).max(repositoryDetailLimits.platforms).default([]),
  software_forms: z.array(z.enum(['cli', 'desktop', 'web', 'library', 'plugin', 'model', 'agent'])).max(7).default([]),
  deployment_modes: z.array(z.enum(['local', 'self-hosted', 'managed', 'container'])).max(4).default([]),
  problem: text.nullable(),
  features: z.array(text).max(repositoryDetailLimits.features),
  scenarios: z.array(text).max(repositoryDetailLimits.scenarios),
  architecture: text.nullable(),
  quickstart: z.array(z.object({ description: text, command: text.nullable() }).strict()).max(repositoryDetailLimits.quickstart),
  deployment: text.nullable(),
  cost: text.nullable(),
  maintenance: text.nullable(),
}).strict();

export const repositoryDetailsSchema = repositoryDetailContentSchema.extend({
  adjustments: z.array(z.object({ field: z.string().max(40), originalCount: z.number().int().nonnegative(), retainedCount: z.number().int().nonnegative() }).strict()).max(8).optional(),
  version: z.literal(1),
  generated_at: z.iso.datetime(),
  repository_pushed_at: z.string().nullable(),
  model: text,
  sources: z.array(z.object({
    label: text,
    url: z.url().refine((url) => /^https?:\/\//.test(url)),
    retrieved_at: z.iso.datetime(),
  }).strict()).max(10),
}).strict();

export function readRepositoryDetails(value: unknown): RepositoryDetailsAnalysis | null {
  const parsed = repositoryDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
