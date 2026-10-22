import { AIRequestError, getRetryAfterMsFromError } from './aiService';
import { withDeadline, waitForRequest } from '../utils/requestDeadline';
import { parseOrganizationJSON } from './aiOrganizationService';
import { OrganizationBlockedError, organizationFatalError } from './aiOrganizationReadiness';

export class OrganizationBudgetError extends OrganizationBlockedError {
  constructor(message: string, code = 'BATCH_REQUEST_BUDGET') { super(code, message); }
}
export class OrganizationDeferredError extends Error {}
export const organizationAuthError = (error: unknown) => error instanceof AIRequestError && [401, 403].includes(error.status);
export interface OrganizationRequestBudget { used: number; limit: number }
export async function organizationRequest<T>(work: (signal: AbortSignal) => Promise<T>, budget: OrganizationRequestBudget, signal: AbortSignal, timeoutMs: number | undefined, onRequest?: () => Promise<void>, onFailure?: (error: unknown) => void | Promise<void>, maxAttempts = 3, onDeferred?: () => void): Promise<T> {
  for (let retry = 0; ; retry++) {
    signal.throwIfAborted();
    if (budget.used >= budget.limit) throw new OrganizationBudgetError('Model request limit reached');
    budget.used++;
    await onRequest?.();
    try { return await (timeoutMs === undefined ? work(signal) : withDeadline(work, timeoutMs, signal)); }
    catch (error) {
      signal.throwIfAborted();
      if (error instanceof OrganizationDeferredError) {
        budget.used--; onDeferred?.();
        throw new OrganizationBlockedError('RESOURCE_DEFERRED', error.message);
      }
      if (organizationAuthError(error)) throw error;
      if (error instanceof OrganizationBlockedError || organizationFatalError(error)) throw error;
      const carrier=error as {providerOutcome?:string;details?:{sent?:boolean;providerOutcome?:string}}|null;
      if(['unknown','in_flight','succeeded'].includes(carrier?.providerOutcome??carrier?.details?.providerOutcome??'')||carrier?.details?.sent===true)throw new OrganizationBlockedError('UNKNOWN_PROVIDER_OUTCOME',error instanceof Error?error.message:String(error));
      // Only admission/init/rate rejection proves that no generation completed.
      // A sent request timeout/network disconnect may already have billed.
      if (error instanceof Error && /AGY_(?:TIMEOUT|CLEANUP_TIMEOUT|PROCESS_EXIT_TIMEOUT)|network|fetch|deadline|socket|ECONN/i.test(`${error.name} ${error.message}`)) {
        throw new OrganizationBlockedError('UNKNOWN_PROVIDER_OUTCOME', error.message);
      }
      await onFailure?.(error);
      const agyRetryable = error instanceof Error && (/^AGY_(?:BUSY|INIT_TIMEOUT|QUEUE_TIMEOUT)$/.test(error.message)||error.message==='AGY_RATE_LIMIT'&&carrier?.details?.sent===false);
      const status = error instanceof AIRequestError ? error.status : 0;
      const retryable = agyRetryable || status===429 || carrier?.details?.sent===false && [408, 500, 502, 503, 504].includes(status) || error instanceof Error && /network|fetch|timeout|deadline|socket|ECONN/i.test(`${error.name} ${error.message}`);
      if (!retryable) throw error;
      if (retry >= Math.max(1, Math.min(3, maxAttempts)) - 1) throw new OrganizationBlockedError(error instanceof Error && /(?:TIMEOUT|deadline|timeout)/i.test(`${error.name} ${error.message}`) ? 'MODEL_TIMEOUT' : 'CONNECTION_FAILED', error instanceof Error ? error.message : String(error));
      await waitForRequest(getRetryAfterMsFromError(error) ?? 500 * 2 ** retry, signal);
    }
  }
}

/** Keep independently valid rows, repair omissions once, then split only unresolved rows. */
export async function collectOrganizationRows<T>(input: {
  ids: number[]; signal: AbortSignal; request: (ids: number[], repair: string | undefined) => Promise<string>;
  parse: (row: unknown) => { id: number; value: T }; onRows?: (rows: Map<number, T>) => Promise<void>;
  onValidation?: (error?: unknown) => void;
}): Promise<{ rows: Map<number, T>; errors: Map<number, string> }> {
  const rows = new Map<number, T>();
  const errors = new Map<number, string>();
  let halted = false;
  const attempt = async (ids: number[], repair?: string): Promise<number[]> => {
    input.signal.throwIfAborted();
    if (halted) return ids.filter(id => !rows.has(id));
    let received = false;
    try {
      const content = await input.request(ids, repair);
      received = true;
      input.signal.throwIfAborted();
      const result = parseOrganizationJSON(content) as { results?: unknown[] };
      if (!Array.isArray(result?.results)) throw new Error('Expected results array');
      const allow = new Set(ids);
      const candidates = new Map<number, T>();
      const duplicates = new Set<number>();
      const invalid: string[] = [];
      for (const row of result.results) {
        try {
          const parsed = input.parse(row);
          if (!allow.has(parsed.id)) continue;
          if (candidates.has(parsed.id)) duplicates.add(parsed.id);
          candidates.set(parsed.id, parsed.value);
        } catch (error) { invalid.push(error instanceof Error ? error.message.slice(0, 500) : 'Invalid result'); }
      }
      for (const [id, value] of candidates) if (!duplicates.has(id)) { rows.set(id, value); errors.delete(id); }
      for (const id of ids) if (!rows.has(id)) errors.set(id, `Missing, duplicate or invalid model result${invalid.length ? `: ${invalid[0]}` : ''}`);
      input.onValidation?.(ids.some(id => !rows.has(id)) ? new Error([...errors.values()].join('; ').slice(0, 1800)) : undefined);
      await input.onRows?.(rows);
    } catch (error) {
      input.signal.throwIfAborted();
      if (organizationAuthError(error) || organizationFatalError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (received) input.onValidation?.(error);
      ids.forEach(id => { if (!rows.has(id) && (!(error instanceof OrganizationBudgetError) || !errors.has(id))) errors.set(id, message); });
      // Transport retries already happen in organizationRequest. Splitting cannot fix them.
      if (!received || error instanceof OrganizationBudgetError) halted = true;
    }
    return ids.filter(id => !rows.has(id));
  };
  const split = async (ids: number[]): Promise<void> => {
    if (!ids.length || halted) return;
    const missing = await attempt(ids);
    if (missing.length <= 1) return;
    const middle = Math.ceil(missing.length / 2);
    await split(missing.slice(0, middle));
    await split(missing.slice(middle));
  };
  let missing = await attempt(input.ids);
  if (missing.length && !halted) missing = await attempt(missing, `Return only missing/invalid IDs, one valid result per ID, matching the requested JSON schema. Do not repeat already accepted IDs. Validation: ${[...new Set(missing.map(id => errors.get(id)))].join('; ').slice(0, 1800)}`);
  if (missing.length > 1 && !halted) {
    const middle = Math.ceil(missing.length / 2);
    await split(missing.slice(0, middle));
    await split(missing.slice(middle));
  }
  return { rows, errors };
}
