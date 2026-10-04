import { describe, expect, it } from 'vitest';
import { platformsFromDetails } from './platformNormalization';

describe('detail platform projection', () => {
  it('keeps CLI and container facets after detailed analysis', () => {
    expect(platformsFromDetails({ platforms: ['Linux', 'Node.js'], software_forms: ['cli'], deployment_modes: ['container'] }))
      .toEqual(['Linux', 'docker', 'cli']);
  });
  it('does not invent a desktop operating system or include runtimes', () => {
    expect(platformsFromDetails({ platforms: ['Python'], software_forms: ['desktop', 'web'], deployment_modes: ['local'] })).toEqual(['web']);
  });
});
