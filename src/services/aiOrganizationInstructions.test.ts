import { describe, expect, it } from 'vitest';
import { organizationInstruction } from './aiOrganizationInstructions';

describe('organization requirement continuation', () => {
  it('retains original constraints while appending a refinement', () => {
    expect(organizationInstruction('Reuse existing categories', 'Split CLI tools')).toBe('Reuse existing categories\nSplit CLI tools');
    expect(organizationInstruction('Reuse existing categories', 'Reuse existing categories')).toBe('Reuse existing categories');
  });
  it('retries the original requirement instead of changing it', () => {
    expect(organizationInstruction('Keep locked assignments', 'Ignore locks', true)).toBe('Keep locked assignments');
  });
  it('rejects oversized combined requirements instead of discarding previous constraints', () => {
    expect(() => organizationInstruction('a'.repeat(6000), 'b'.repeat(5000))).toThrow('limit');
  });
});
