import { expect, it, vi } from 'vitest';
import { createTaskBatchGate } from './taskBatchGate';
it('drains in-flight saves before paused, resumes only waiting claims, and cancels paused waits',async()=>{
  const state=vi.fn(),gate=createTaskBatchGate(state),signal=new AbortController().signal;
  const first=await gate.enter(signal),second=await gate.enter(signal);
  gate.pause();expect(state).toHaveBeenLastCalledWith('pausing');
  const claim=vi.fn();const waiting=gate.enter(signal).then(leave=>{claim();leave();});
  first();expect(claim).not.toHaveBeenCalled();expect(state).toHaveBeenLastCalledWith('pausing');
  second();expect(state).toHaveBeenLastCalledWith('paused');gate.resume();await waiting;expect(claim).toHaveBeenCalledOnce();
  gate.pause();const controller=new AbortController(),canceled=gate.enter(controller.signal);controller.abort();
  await expect(canceled).rejects.toMatchObject({name:'AbortError'});
});
