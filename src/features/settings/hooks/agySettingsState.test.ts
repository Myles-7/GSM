import { describe, expect, it } from 'vitest';
import { mergeAgyDraft, concurrencyPreferences, agyConcurrencyDirty } from './agySettingsState';
import type { AgyDevicePrefs } from '../../../types/agy';
const prefs:AgyDevicePrefs={enabled:true,model:'saved-model',effort:'high',mode:'model',timeoutSeconds:180,maxQueued:10,concurrency:5,featureOverrides:{organization:{concurrency:2,model:'organization-model'}}};
describe('device settings and editable draft reconciliation',()=>{
  it('refreshes untouched fields while preserving unsaved global and feature edits',()=>{
    const draft={...prefs,concurrency:3,featureOverrides:{organization:{...prefs.featureOverrides!.organization,concurrency:1}}};
    const remote={...prefs,timeoutSeconds:240,featureOverrides:{organization:{concurrency:2,model:'new-organization'},discovery:{concurrency:4}}};
    expect(mergeAgyDraft(prefs,draft,remote)).toMatchObject({concurrency:3,timeoutSeconds:240,featureOverrides:{organization:{concurrency:1,model:'new-organization'},discovery:{concurrency:4}}});
    expect(mergeAgyDraft(prefs,prefs,remote)).toEqual(remote);
  });
  it('saves changed limits without publishing model edits or overwriting unrelated remote limits',()=>{
    const draft={...prefs,model:'unsaved-model',concurrency:3,featureOverrides:{organization:{...prefs.featureOverrides!.organization,concurrency:1}}};
    const latest={...prefs,effort:'low' as const,featureOverrides:{...prefs.featureOverrides,discovery:{concurrency:4}}};
    expect(concurrencyPreferences(prefs,draft,latest)).toEqual({...latest,concurrency:3,featureOverrides:{...latest.featureOverrides,organization:{concurrency:1,model:'organization-model'}}});
    expect(agyConcurrencyDirty(prefs,draft)).toBe(true);
    expect(agyConcurrencyDirty(prefs,{...prefs,model:'unsaved-model'})).toBe(false);
  });
});
