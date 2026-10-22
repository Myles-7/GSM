// Isolated settings UI fixture. No executable, model, or personal preferences are used.
import { useAppStore } from '../../src/store/useAppStore';
import type { AgyDevicePrefs, AgyDesktopAPI, AgyDeviceState } from '../../src/types/agy';
export function configureAgySettingsAudit() {
  if(useAppStore.getState().user?.id!==990001)throw Error('Settings audit requires the isolated synthetic account');
  const key='gsm-audit-agy-preferences';
  let prefs:AgyDevicePrefs=JSON.parse(localStorage.getItem(key)??'null')??{model:'synthetic-agy-model',effort:'medium',mode:'model',timeoutSeconds:180,maxQueued:10,concurrency:5,enabled:true,featureOverrides:{}};
  let revision=1;
  const snapshot=():AgyDeviceState=>({revision,prefs:structuredClone(prefs),supported:true,enabled:prefs.enabled,executable:{name:'Synthetic AGY (UI only)',fingerprint:'synthetic'},busy:false,
    lastProbe:{code:'SUCCESS',toolCount:0,at:new Date().toISOString(),fingerprint:'synthetic',promptsSent:0},pool:{running:0,queued:0,limit:prefs.concurrency??5,effective:prefs.concurrency??5,cooldownUntil:0,features:{}}});
  const api:AgyDesktopAPI={getState:async()=>snapshot(),save:async(_id,next)=>{prefs=structuredClone(next);revision++;localStorage.setItem(key,JSON.stringify(prefs));return {ok:true,value:snapshot()};},
    setSession:async()=>{},cancel:async()=>{},onEvent:()=>()=>{},
    detect:async()=>({ok:true,value:snapshot()}),choose:async()=>({ok:false,code:'CANCELED'}),recover:async()=>({ok:true,value:snapshot()}),listModels:async()=>({ok:true,value:[]}),
    probe:async()=>({ok:false,code:'AUDIT_MODEL_CALL_BLOCKED'}),start:async()=>({ok:false,code:'AUDIT_MODEL_CALL_BLOCKED'}),
    recoveryList:async()=>({ok:true,value:{records:[],errors:[]}}),recoveryRead:async()=>({ok:false,code:'NOT_FOUND'}),recoveryAck:async()=>({ok:true,value:undefined}),recoveryStage:async()=>({ok:true,value:undefined}),recoveryDiscard:async()=>({ok:false,code:'NOT_FOUND'}),recoveryRepair:async()=>({ok:false,code:'NOT_FOUND'}),
    chooseProject:async()=>({ok:false,code:'CANCELED'}),readProject:async()=>({ok:false,code:'NOT_FOUND'}),revokeProject:async()=>{}};
  Object.defineProperty(window,'electronAPI',{configurable:true,value:{agy:api}});
  sessionStorage.setItem('gsm:pending-settings-tab','ai');
  useAppStore.setState({activeAIConfig:'agy-cli-local',currentView:'settings'});
}
