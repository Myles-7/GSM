import { beforeEach, expect, it, vi } from 'vitest';
import type { AgyDeviceState } from '../types/agy';
const mocks=vi.hoisted(()=>({configs:[] as {id:string;concurrency?:number;agyRevision?:number}[],set:vi.fn()}));
vi.mock('../store/useAppStore',()=>({useAppStore:{getState:()=>({aiConfigs:mocks.configs,setAIConfigs:(configs:typeof mocks.configs)=>{mocks.configs=configs;mocks.set(configs);}}),subscribe:()=>()=>{}}}));
import { applyAgyDeviceState } from './agyClient';
const device=(revision:number,concurrency:number):AgyDeviceState=>({revision,prefs:{concurrency,model:'model',effort:'high',mode:'model',timeoutSeconds:180,maxQueued:10,enabled:true},supported:true,enabled:true,executable:{name:'agy',fingerprint:'f'},lastProbe:null,busy:false});
beforeEach(()=>{mocks.configs=[];mocks.set.mockClear();window.electronAPI={agy:{}} as never;});
it('does not let a delayed older device snapshot revert saved concurrency',()=>{
  expect(applyAgyDeviceState(device(3,2))).toBe(true);
  expect(applyAgyDeviceState(device(2,5))).toBe(false);
  expect(mocks.configs[0].concurrency).toBe(2);expect(mocks.set).toHaveBeenCalledOnce();
});
it('accepts the fresh revision sequence of a newly connected device bridge',()=>{
  applyAgyDeviceState(device(10,2));window.electronAPI={agy:{}} as never;
  expect(applyAgyDeviceState(device(1,4))).toBe(true);expect(mocks.configs[0].concurrency).toBe(4);
});
