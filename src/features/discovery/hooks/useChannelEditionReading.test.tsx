import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeAssessment, makeEdition } from '../custom/fixtures.test-support';
import { editionKey } from '../custom/model';
import { useChannelEditionReading } from './useChannelEditionReading';

afterEach(cleanup);
describe('stable custom-edition reading', () => {
  it('announces a newer day without replacing the list until the user chooses it', () => {
    const old = makeEdition(), next = { ...makeEdition(), date: '2026-10-02', generatedAt: '2026-10-02T09:00:00Z', entries: [makeAssessment(2)] };
    const { result, rerender } = renderHook(({ editions }) => useChannelEditionReading(editions), { initialProps: { editions: [old] } });
    rerender({ editions: [next, old] });
    expect(result.current.hasUpdate).toBe(true);
    expect(result.current.edition?.entries[0].repo.id).toBe(1);
    act(() => result.current.showLatest());
    expect(result.current.edition?.entries[0].repo.id).toBe(2);
    expect(result.current.hasUpdate).toBe(false);
  });
  it('keeps a same-day snapshot on background refresh while accepting same-identity human decisions', () => {
    const old = makeEdition();
    const { result, rerender } = renderHook(({ editions }) => useChannelEditionReading(editions), { initialProps: { editions: [old] } });
    const approved = { ...old, entries: [...old.entries, makeAssessment(3)] };
    rerender({ editions: [approved] });
    expect(result.current.edition?.entries).toHaveLength(2);
    const next = { ...old, generatedAt: '2026-09-28T12:00:00Z', entries: [makeAssessment(2)] };
    rerender({ editions: [next] });
    expect(result.current.edition?.entries).toHaveLength(2);
    expect(result.current.hasUpdate).toBe(true);
    act(() => result.current.select(editionKey(next)));
    expect(result.current.edition).toBe(next);
  });
  it('displays the first saved edition when initial storage loading finishes', () => {
    const { result, rerender } = renderHook(({ editions }) => useChannelEditionReading(editions), { initialProps: { editions: [] as ReturnType<typeof makeEdition>[] } });
    rerender({ editions: [makeEdition()] });
    expect(result.current.edition).toBeDefined();
    expect(result.current.hasUpdate).toBe(false);
  });
});
