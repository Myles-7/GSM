import type { AIConfig } from '../types';
import { isAIConfigAvailable, isAgyConfig } from '../utils/aiConfig';
import { classifyAgyError } from './agyErrors';

export class OrganizationBlockedError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = 'OrganizationBlockedError'; }
}

export function organizationFatalError(error: unknown): boolean {
  if (['configuration', 'deferred', 'unknown'].includes(classifyAgyError(error))) return true;
  const code = organizationProblemCode(error);
  return !!code && ['MODEL_MISSING', 'MODEL_CONFIGURATION', 'AUTH_REQUIRED', 'GITHUB_AUTH_REQUIRED',
    'AGY_AUTH_REQUIRED', 'AGY_DISABLED', 'AGY_DESKTOP_REQUIRED', 'AGY_NOT_FOUND', 'AGY_TEST_REQUIRED',
    'AGY_CONFIG_CHANGED', 'AGY_MODEL_EFFORT_CONFLICT', 'AGY_EXECUTABLE_CHANGED', 'AGY_SESSION_CHANGED',
    'AGY_NATIVE_TOOL_CALL', 'AGY_PERMISSION_DENIED', 'AGY_QUOTA_EXHAUSTED', 'AGY_BUDGET_LIMIT',
    'RESOURCE_WAIT', 'REQUEST_CIRCUIT_OPEN', 'TASK_REQUEST_BUDGET'].includes(code);
}

export function organizationProblemCode(error: unknown): string | undefined {
  if (error instanceof OrganizationBlockedError) return error.code;
  const code = error instanceof Error ? error.message.match(/^AGY_([A-Z_]+)$/)?.[0] : undefined;
  if (code) return code;
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return 'AUTH_REQUIRED';
  if ([400, 404, 422].includes(status ?? 0)) return 'MODEL_CONFIGURATION';
  return undefined;
}

export function assertOrganizationModelReady(config: AIConfig | undefined): asserts config is AIConfig {
  if (!config) throw new OrganizationBlockedError('MODEL_MISSING');
  if (isAgyConfig(config)) {
    if (!config.isActive) throw new OrganizationBlockedError('AGY_DISABLED');
    if (typeof window === 'undefined' || !window.electronAPI?.agy) throw new OrganizationBlockedError('AGY_DESKTOP_REQUIRED');
    if (!config.deviceBound) throw new OrganizationBlockedError('AGY_NOT_FOUND');
  }
  if (!isAIConfigAvailable(config)) throw new OrganizationBlockedError('MODEL_CONFIGURATION');
}
