import { z } from 'zod';
import type { RepositoryDetailsAnalysis } from '../types/repositoryDetails';

const text = z.string().trim().min(1).max(12000);
export const repositoryDetailContentSchema = z.object({
  summary: text.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  platforms: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  software_forms: z.array(z.enum(['cli', 'desktop', 'web', 'library', 'plugin', 'model', 'agent'])).max(7).default([]),
  deployment_modes: z.array(z.enum(['local', 'self-hosted', 'managed', 'container'])).max(4).default([]),
  problem: text.nullable(),
  features: z.array(text).max(30),
  scenarios: z.array(text).max(30),
  architecture: text.nullable(),
  quickstart: z.array(z.object({ description: text, command: text.nullable() }).strict()).max(20),
  deployment: text.nullable(),
  cost: text.nullable(),
  maintenance: text.nullable(),
}).strict();

export const repositoryDetailsSchema = repositoryDetailContentSchema.extend({
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
