import { describe, expect, it, vi } from 'vitest';
import { clampFilterPosition, defaultFilterPreferences, filterPreferencesKey, parseFilterPreferences, readFilterPreferences, saveFilterPreferences } from './facetWindowPreferences';

describe('facet window preferences', () => {
  it('repairs malformed data, removes duplicate and invalid groups and favorites', () => {
    expect(parseFilterPreferences('{broken')).toEqual(defaultFilterPreferences());
    expect(parseFilterPreferences('null')).toEqual(defaultFilterPreferences());
    const preferences = parseFilterPreferences(JSON.stringify({ position: { x: 'bad', y: 50 }, groups: ['scenario', 'scenario', 'invalid'], hidden: ['technology', 'bad'], favorites: [{ id: 'technology:react', group: 'technology', label: 'React' }, { id: 'technology:react', group: 'technology', label: 'React' }, { id: 'confidence:high', group: 'confidence', label: 'high' }, null, { id: 'wrong', group: 'scenario', label: 'bad' }] }));
    expect(preferences).toEqual({ position: null, groups: ['scenario', 'technology', 'platform'], hidden: ['technology'], favorites: [{ id: 'technology:react', group: 'technology', label: 'React' }] });
  });
  it('clamps negative and offscreen positions for desktop and narrow viewports', () => {
    expect(clampFilterPosition({ x: 9999, y: -9 }, { width: 1000, height: 800 }, { width: 380, height: 560 })).toEqual({ x: 608, y: 12 });
    expect(clampFilterPosition({ x: 9999, y: 9999 }, { width: 320, height: 500 }, { width: 296, height: 300 })).toEqual({ x: 12, y: 188 });
  });
  it('isolates account storage and tolerates unavailable storage', () => {
    localStorage.clear();
    const preferences = { ...defaultFilterPreferences(), position: { x: 20, y: 30 } };
    saveFilterPreferences('alice', preferences);
    expect(readFilterPreferences('alice')).toEqual(preferences);
    expect(readFilterPreferences('bob')).toEqual(defaultFilterPreferences());
    expect(filterPreferencesKey('account:1')).toContain('account%3A1');
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readFilterPreferences('alice')).toEqual(defaultFilterPreferences());
    get.mockRestore();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => saveFilterPreferences('alice', preferences)).not.toThrow();
    set.mockRestore();
  });
});
