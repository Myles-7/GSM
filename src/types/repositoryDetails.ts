export interface RepositoryDetailsAnalysis {
  summary?: string | null;
  tags?: string[];
  platforms?: string[];
  software_forms?: ('cli' | 'desktop' | 'web' | 'library' | 'plugin' | 'model' | 'agent')[];
  deployment_modes?: ('local' | 'self-hosted' | 'managed' | 'container')[];
  version: 1;
  generated_at: string;
  repository_pushed_at: string | null;
  model: string;
  sources: { label: string; url: string; retrieved_at: string }[];
  problem: string | null;
  features: string[];
  scenarios: string[];
  architecture: string | null;
  quickstart: { description: string; command: string | null }[];
  deployment: string | null;
  cost: string | null;
  maintenance: string | null;
}
