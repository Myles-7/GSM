import { describe, expect, it, vi } from 'vitest';
import { organizationLightProfile } from './aiOrganizationProfiles';

describe('organization effort compatibility', () => {
  it('does not probe conflicting efforts for separately named Gemini variants', async () => {
    const request = vi.fn();
    const config = { id:'agy',name:'AGY',provider:'agy-cli' as const,model:'gemini-3.8-flash-medium',agyEffort:'medium' as const,isActive:true,agyMode:'model' as const,deviceBound:true };
    expect(await organizationLightProfile(config,'fixture',request,new AbortController().signal)).toBe(config);
    expect(request).not.toHaveBeenCalled();
  });
});
