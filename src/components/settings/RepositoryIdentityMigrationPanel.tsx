import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ScanSearch } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { previewRepositoryIdentityMigration, readRepositoryIdentityJournal, runRepositoryIdentityMigration, restoreRepositoryIdentityMigration } from '../../services/repositoryIdentityMigration';
import { useT } from '../../i18n/useT';

type AccountScope = { account: string; epoch: number };
type PanelState = {
  scope: AccountScope;
  preview?: Awaited<ReturnType<typeof previewRepositoryIdentityMigration>>;
  selected: Set<number>;
  journal: Awaited<ReturnType<typeof readRepositoryIdentityJournal>>;
  journalLoading: boolean;
  busy: boolean;
  error: string;
};
const initialState = (scope: AccountScope): PanelState => ({
  scope, selected: new Set(), journal: null, journalLoading: !!scope.account, busy: false, error: '',
});
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function RepositoryIdentityMigrationPanel() {
  const t=useT('settings');
  const account=useAppStore(state=>String(state.user?.id ?? ''));
  const scopeRef=useRef<AccountScope>({account,epoch:0});
  if(scopeRef.current.account!==account) scopeRef.current={account,epoch:scopeRef.current.epoch+1};
  const scope=scopeRef.current;
  const mounted=useRef(true);
  const journalRequest=useRef(0);
  const operation=useRef<{scope:AccountScope}|null>(null);
  const [state,setState]=useState(()=>initialState(scope));
  // Scope the rendered state too: effects must not expose the old account's recovery controls.
  const {preview,selected,journal,journalLoading,busy,error}=state.scope===scope ? state : initialState(scope);
  const isCurrent=useCallback((target:AccountScope)=>mounted.current && scopeRef.current===target
    && String(useAppStore.getState().user?.id ?? '')===target.account,[]);
  const update=useCallback((target:AccountScope,patch:Partial<PanelState>|((previous:PanelState)=>Partial<PanelState>))=>{
    if(!isCurrent(target)) return;
    setState(previous=>{
      if(!isCurrent(target)) return previous;
      const current=previous.scope===target ? previous : initialState(target);
      return {...current,...(typeof patch==='function' ? patch(current) : patch)};
    });
  },[isCurrent]);
  useEffect(()=>{
    mounted.current=true;
    // A -> B -> A can be batched into one render; invalidate on each store account transition.
    const unsubscribe=useAppStore.subscribe(next=>{
      const nextAccount=String(next.user?.id ?? '');
      if(scopeRef.current.account===nextAccount) return;
      const nextScope={account:nextAccount,epoch:scopeRef.current.epoch+1};
      scopeRef.current=nextScope;
      setState(initialState(nextScope));
    });
    return ()=>{mounted.current=false;unsubscribe();};
  },[]);
  const loadJournal=useCallback(async(target:AccountScope)=>{
    if(!target.account || !isCurrent(target)) return;
    const request=++journalRequest.current;
    try {
      const value=await readRepositoryIdentityJournal(target.account);
      if(request===journalRequest.current) update(target,{journal:value,journalLoading:false});
    } catch(e) {
      if(request===journalRequest.current) update(target,previous=>({
        journalLoading:false,error:previous.error || errorMessage(e),
      }));
    }
  },[isCurrent,update]);
  useEffect(()=>{
    update(scope,initialState(scope));
    void loadJournal(scope);
  },[scope,loadJournal,update]);
  const run=async(work:()=>Promise<void>)=>{
    if(!scope.account || !isCurrent(scope) || operation.current?.scope===scope) return;
    const currentOperation={scope};
    operation.current=currentOperation;
    update(scope,{busy:true,error:''});
    try {await work();}
    catch(e) {update(scope,{error:errorMessage(e)});}
    finally {
      if(isCurrent(scope) && operation.current===currentOperation) {
        await loadJournal(scope);
        update(scope,{busy:false});
      }
      if(operation.current===currentOperation) operation.current=null;
    }
  };
  const pending=journal && journal.phase!=='restored' && (journal.phase!=='complete' || !!journal.error);
  return <details className="rounded-xl border border-border p-4" open={pending || undefined}>
    <summary className="cursor-pointer text-sm font-semibold">{t('identityMigration.title',{defaultValue:'Repository Identity'})}</summary>
    <section className="mt-4 space-y-3">
    <p className="text-sm leading-relaxed text-muted-foreground">{t('settingsUx.identityHelp')}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={busy||journalLoading||!!pending||!account} onClick={()=>void run(async()=>{
        const result=await previewRepositoryIdentityMigration();
        if(result.account!==scope.account) throw new Error('IDENTITY_ACCOUNT_CHANGED');
        update(scope,{preview:result,selected:new Set()});
      })}
        className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm disabled:opacity-50">
        <ScanSearch size={16}/>{t('identityMigration.preview',{defaultValue:'Dry Run'})}
      </button>
      {pending && <button disabled={busy} onClick={()=>void run(()=>runRepositoryIdentityMigration())}
        className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm disabled:opacity-50">
        <RefreshCw size={16}/>{t('identityMigration.resume',{defaultValue:'Resume Migration'})}
      </button>}
      {journal && journal.phase!=='restored' && <button disabled={busy} onClick={()=> {
        if (window.confirm(t('identityMigration.paused',{defaultValue:'Restore all associated storage together? All writers must be paused.'}))) void run(()=>restoreRepositoryIdentityMigration());
      }} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50">
        {t('identityMigration.restore',{defaultValue:'Restore Associated Storage'})}
      </button>}
      {preview && <button disabled={busy||!selected.size||!!pending} onClick={()=>void run(async()=>{
        if (preview.account !== scope.account) throw new Error('IDENTITY_ACCOUNT_CHANGED');
        const mappings=preview.candidates.filter(row=>selected.has(row.oldId)&&row.candidates.length===1).map(row=>({
          oldId:row.oldId,newId:row.candidates[0],fullName:row.fullName,evidence:'explicit user confirmation after identity dry-run',
        }));
        await runRepositoryIdentityMigration(mappings);update(scope,{preview:undefined,selected:new Set()});
      })} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50">
        {t('identityMigration.apply',{defaultValue:'Apply Confirmed Mappings'})}
      </button>}
    </div>
    {pending && <p role="status" className="text-sm text-amber-600">{t('identityMigration.paused',{defaultValue:'Writes paused. Resume the original account and workspace, or restore all associated storage together.'})} {journal.steps.join(', ')}</p>}
    {preview && <>
      <p className="text-sm text-muted-foreground">{t('identityMigration.warning',{defaultValue:'Matching names do not prove identity. Confirm only after checking that the old name was not reused; ambiguous rows remain unchanged.'})}</p>
      <div className="max-h-64 overflow-auto divide-y divide-border">
        {preview.candidates.map(row=><label key={row.oldId} className="flex gap-3 py-2 text-sm">
          <input type="checkbox" disabled={busy||row.candidates.length!==1} checked={selected.has(row.oldId)} onChange={event=>{
            const checked=event.target.checked;
            update(scope,previous=>{const next=new Set(previous.selected);if(checked)next.add(row.oldId);else next.delete(row.oldId);return {selected:next};});
          }}/>
          <span className="min-w-0 break-all">{row.fullName}<span className="block font-mono text-xs text-muted-foreground">{row.oldId} → {row.candidates.join(', ')||'?'}</span></span>
        </label>)}
      </div>
      {!preview.candidates.length && <p className="text-sm text-muted-foreground">{t('identityMigration.noCandidates',{defaultValue:'No legacy identity candidates.'})}</p>}
    </>}
    {error && <p role="alert" className="break-all text-sm text-destructive">{error}</p>}
  </section></details>;
}
