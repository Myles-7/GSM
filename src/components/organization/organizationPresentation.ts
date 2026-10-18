import type { DualOrganizationDraft } from '../../types/aiOrganization';
import { organizationProblemCode } from '../../services/aiOrganizationReadiness';

export function organizationProgress(dual: DualOrganizationDraft | undefined, total: number) {
  const rows = dual?.understanding ?? [];
  const legacyCode = rows.length && rows.every(row => row.status === 'failed' && row.error === rows[0].error) ? organizationProblemCode(new Error(rows[0].error)) : undefined;
  const blocked = dual?.blocked ?? (legacyCode ? { code: legacyCode, message: rows[0].error ?? legacyCode, phase: 'understanding' as const } : undefined);
  const understood = rows.filter(row => row.status === 'understood').length;
  const failed = legacyCode ? 0 : rows.filter(row => ['failed', 'read-failed'].includes(row.status)).length;
  const uncertain = rows.filter(row => row.status === 'insufficient').length;
  return { blocked, understood, failed, uncertain, pending: Math.max(0, total - understood - failed - uncertain), done: understood + failed + uncertain };
}
export const modelProblemKey = (code: string) => `organizationUx.problems.${
  ['MODEL_TIMEOUT', 'AGY_TIMEOUT', 'AGY_INIT_TIMEOUT', 'AGY_QUEUE_TIMEOUT'].includes(code) ? 'timeout' : code === 'AGY_DISABLED' ? 'disabled' : code === 'AGY_DESKTOP_REQUIRED' ? 'desktop' : code === 'MODEL_MISSING' ? 'missing'
    : ['AUTH_REQUIRED', 'GITHUB_AUTH_REQUIRED', 'AGY_AUTH_REQUIRED'].includes(code) ? 'auth'
      : ['CONNECTION_FAILED', 'GITHUB_CONNECTION_FAILED', 'GITHUB_RATE_LIMIT'].includes(code) ? 'connection'
        : ['MODEL_CONFIGURATION', 'AGY_MODEL_EFFORT_CONFLICT'].includes(code) ? 'configuration' : code === 'AGY_IO_FAILED' ? 'io' : code === 'AGY_CLEANUP_TIMEOUT' ? 'cleanup' : 'other'}`;
