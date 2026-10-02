import { describe, expect, it, vi } from 'vitest';
import { aiTaskJournal } from './aiTaskJournal';

describe('AI task projection and recovery', () => {
  it('projects existing controls and keeps completed items out of interrupted work', () => {
    const task = aiTaskJournal.begin('owner', 'summary', [{ id: '1', label: 'One' }, { id: '2', label: 'Two' }]);
    const controls = { pause: vi.fn(), resume: vi.fn(), stop: vi.fn() };
    task.bind(controls);
    aiTaskJournal.control(task.id, 'pause');
    expect(controls.pause).toHaveBeenCalledOnce();
    task.item('1', 'complete'); task.item('2', 'running'); task.finish();
    expect(aiTaskJournal.live(task.id)).toBe(false);
    expect(aiTaskJournal.snapshot().find(item => item.id === task.id)).toMatchObject({
      state: 'interrupted', items: [{ id: '1', state: 'complete' }, { id: '2', state: 'pending' }],
    });
  });
  it('loads running checkpoints as interrupted without invoking models', () => {
    localStorage.setItem('gsm:ai-task-journal:restart-owner', JSON.stringify([{ id: 'restored', owner: 'restart-owner',
      kind: 'gists', state: 'running', updatedAt: '', items: [{ id: 'gist', label: 'Gist', state: 'running' }] }]));
    aiTaskJournal.load('restart-owner');
    expect(aiTaskJournal.snapshot().find(item => item.id === 'restored')).toMatchObject({
      state: 'interrupted', items: [{ state: 'pending' }],
    });
    expect(aiTaskJournal.live('restored')).toBe(false);
  });
  it('stops only the requested account', () => {
    const one = aiTaskJournal.begin('one', 'details', []), two = aiTaskJournal.begin('two', 'details', []);
    const stopOne = vi.fn(), stopTwo = vi.fn();
    one.bind({ pause() {}, resume() {}, stop: stopOne });
    two.bind({ pause() {}, resume() {}, stop: stopTwo });
    aiTaskJournal.stopOwner('one');
    expect(stopOne).toHaveBeenCalledOnce();
    expect(stopTwo).not.toHaveBeenCalled();
    one.finish(); two.finish();
  });
});
