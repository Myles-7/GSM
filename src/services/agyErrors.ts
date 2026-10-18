const configurationCodes = new Set(['DISABLED', 'AUTH_REQUIRED', 'PERMISSION_DENIED', 'QUOTA_EXHAUSTED', 'BUDGET_LIMIT',
  'MODEL_EFFORT_CONFLICT', 'TEST_REQUIRED', 'NOT_FOUND', 'INVALID_MODEL', 'INVALID_EFFORT', 'EXECUTABLE_CHANGED',
  'CONFIG_CHANGED', 'SESSION_CHANGED', 'RECOVERY_CONTEXT_LIMIT', 'RECOVERY_STORAGE_FULL', 'RECOVERY_RECORD_CORRUPT', 'RECOVERY_ENCRYPTION_UNAVAILABLE', 'RECOVERY_WRITE_FAILED']);
export function classifyAgyError(error: unknown): 'configuration' | 'deferred' | 'unknown' | 'request' {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^AGY_([A-Z_]+)(?:$|:)/.exec(message)?.[1] ?? (error as { code?: string })?.code;
  if (code && configurationCodes.has(code)) return 'configuration';
  if (code && ['RESOURCE_DEFERRED', 'BUSY', 'QUEUE_TIMEOUT'].includes(code)) return 'deferred';
  if (code && ['UNKNOWN_PROVIDER_OUTCOME', 'unknown_provider_outcome'].includes(code)) return 'unknown';
  return 'request';
}
