import type { AgyRecoveryRecord } from '../types/agy';

/** Only an explicit continuation may replace a repair proven never dispatched. */
export function canContinueUnsentRepair(record: AgyRecoveryRecord, explicit: boolean, recoveryOnly = false) {
  return explicit && !recoveryOnly && record.dispatch === 'prepared' &&
    ['failed', 'not_started'].includes(record.providerOutcome) && !record.receipt && !record.resultDigest;
}
