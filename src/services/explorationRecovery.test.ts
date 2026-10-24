import {describe,it,expect} from 'vitest';
import {canContinueUnsentRepair} from './explorationRecovery';
import type {AgyRecoveryRecord} from '../types/agy';
const record:AgyRecoveryRecord={requestId:'repair',inputDigest:'hash',profile:'low',dispatch:'prepared',providerOutcome:'failed',failureCode:'INIT_TIMEOUT',recoverable:false,createdAt:'now'};
describe('repair continuation certainty',()=>{
  it('permits the observed pre-dispatch timeout only on explicit continuation',()=>{
    expect(canContinueUnsentRepair(record,true)).toBe(true);
    expect(canContinueUnsentRepair(record,false)).toBe(false);
    expect(canContinueUnsentRepair(record,true,true)).toBe(false);
  });
  it('never infers permission from a failed status alone, missing result or old receipt',()=>{
    for(const change of [{dispatch:'sent' as const},{providerOutcome:'unknown' as const},{providerOutcome:'in_flight' as const},{providerOutcome:'succeeded' as const},{receipt:'consumed' as const},{resultDigest:'digest'}])expect(canContinueUnsentRepair({...record,...change},true)).toBe(false);
  });
});
