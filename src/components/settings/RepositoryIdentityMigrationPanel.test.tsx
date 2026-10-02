import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import type { AppState } from '../../types';
import type { readRepositoryIdentityJournal } from '../../services/repositoryIdentityMigration';
import { RepositoryIdentityMigrationPanel } from './RepositoryIdentityMigrationPanel';

const mocks=vi.hoisted(()=>({
  preview:vi.fn(),read:vi.fn(),run:vi.fn(),restore:vi.fn(),
}));
vi.mock('../../store/useAppStore',async()=>{
  const {create}=await import('zustand');
  return {useAppStore:create(()=>({user:{id:77},language:'en'}))};
});
vi.mock('../../services/repositoryIdentityMigration',()=>({
  previewRepositoryIdentityMigration:mocks.preview,
  readRepositoryIdentityJournal:mocks.read,
  runRepositoryIdentityMigration:mocks.run,
  restoreRepositoryIdentityMigration:mocks.restore,
}));

type Journal=NonNullable<Awaited<ReturnType<typeof readRepositoryIdentityJournal>>>;
const user=(id:number)=>({id,login:`account-${id}`} as NonNullable<AppState['user']>);
const journal=(account='77',phase:Journal['phase']='prepared',error?:string)=>({
  version:1 as const,id:`journal-${account}`,account,workspace:null,phase,
  mappings:[],steps:[`step-${account}`],error,
});
const preview=(account='77',name='old/repo')=>({
  account,incoming:[],candidates:[{
    oldId:1_700_000_000_000,fullName:name,candidates:[99],reason:'confirmation-required' as const,
  }],
});
function deferred<T>() {
  let resolve!:(value:T)=>void;
  let reject!:(error:Error)=>void;
  const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});
  return {promise,resolve,reject};
}
const dryRun=()=>screen.getByRole('button',{name:'Dry Run'});
const resume=()=>screen.getByRole('button',{name:'Resume Migration'});
const restore=()=>screen.getByRole('button',{name:'Restore Associated Storage'});
const apply=()=>screen.getByRole('button',{name:'Apply Confirmed Mappings'});
const ready=async()=>{await waitFor(()=>expect(dryRun()).toBeEnabled());};
const switchAccount=(id:number|null)=>act(()=>{useAppStore.setState({user:id===null ? null : user(id)});});

beforeEach(()=>{
  vi.resetAllMocks();
  useAppStore.setState({user:user(77),language:'en'});
  mocks.read.mockResolvedValue(null);
  mocks.preview.mockResolvedValue(preview());
  mocks.run.mockResolvedValue(undefined);
  mocks.restore.mockResolvedValue(undefined);
  vi.spyOn(window,'confirm').mockReturnValue(true);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('RepositoryIdentityMigrationPanel account isolation',()=>{
  it('clears old recovery controls immediately while the new account journal is loading',async()=>{
    const next=deferred<ReturnType<typeof journal>|null>();
    mocks.read.mockImplementation((account:string)=>account==='77' ? Promise.resolve(journal()) : next.promise);
    render(<RepositoryIdentityMigrationPanel/>);
    await screen.findByRole('button',{name:'Resume Migration'});
    expect(screen.getByRole('status')).toHaveTextContent('step-77');
    switchAccount(88);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button',{name:'Resume Migration'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Restore Associated Storage'})).toBeNull();
    expect(dryRun()).toBeDisabled();
    await act(async()=>{next.resolve(journal('88'));});
    expect(screen.getByRole('status')).toHaveTextContent('step-88');
  });

  it('ignores an old journal result arriving after the new account journal',async()=>{
    const old=deferred<ReturnType<typeof journal>|null>();
    mocks.read.mockImplementation((account:string)=>account==='77' ? old.promise : Promise.resolve(journal('88')));
    render(<RepositoryIdentityMigrationPanel/>);
    switchAccount(88);
    await screen.findByRole('button',{name:'Resume Migration'});
    await act(async()=>{old.resolve(journal());});
    expect(screen.getByRole('status')).toHaveTextContent('step-88');
    expect(screen.getByRole('status')).not.toHaveTextContent('step-77');
    expect(mocks.read.mock.calls).toEqual([['77'],['88']]);
  });

  it.each([88,null])('discards a late dry-run result after switching to %s',async(account)=>{
    const old=deferred<ReturnType<typeof preview>>();
    mocks.preview.mockReturnValue(old.promise);
    render(<RepositoryIdentityMigrationPanel/>);
    await ready();
    fireEvent.click(dryRun());
    expect(mocks.preview).toHaveBeenCalledOnce();
    switchAccount(account);
    await act(async()=>{old.resolve(preview());});
    expect(screen.queryByText('old/repo')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button',{name:'Apply Confirmed Mappings'})).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.read.mock.calls).toEqual(account===null ? [['77']] : [['77'],['88']]);
    if(account===null) expect(dryRun()).toBeDisabled();
    else await ready();
  });

  it('clears the preview and selected mappings on account switch and logout',async()=>{
    render(<RepositoryIdentityMigrationPanel/>);
    await ready();
    fireEvent.click(dryRun());
    fireEvent.click(await screen.findByRole('checkbox'));
    await waitFor(()=>expect(apply()).toBeEnabled());
    switchAccount(88);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button',{name:'Apply Confirmed Mappings'})).toBeNull();
    await ready();
    mocks.preview.mockResolvedValue(preview('88','new/repo'));
    fireEvent.click(dryRun());
    expect(await screen.findByRole('checkbox')).not.toBeChecked();
    switchAccount(null);
    expect(screen.queryByText('new/repo')).toBeNull();
    expect(screen.queryByRole('button',{name:'Apply Confirmed Mappings'})).toBeNull();
    expect(dryRun()).toBeDisabled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('discards old dry-run results even after a batched A to B to A switch',async()=>{
    const old=deferred<ReturnType<typeof preview>>();
    mocks.preview.mockReturnValueOnce(old.promise).mockResolvedValue(preview('77','current/repo'));
    render(<RepositoryIdentityMigrationPanel/>);
    await ready();
    fireEvent.click(dryRun());
    act(()=>{
      useAppStore.setState({user:user(88)});
      useAppStore.setState({user:user(77)});
    });
    await ready();
    fireEvent.click(dryRun());
    await screen.findByText('current/repo');
    await ready();
    await act(async()=>{old.resolve(preview());});
    expect(screen.queryByText('old/repo')).toBeNull();
    expect(screen.getByText('current/repo')).toBeInTheDocument();
    expect(mocks.read.mock.calls).toEqual([['77'],['77'],['77']]);
  });

  it('discards old journal results after a batched A to B to A switch',async()=>{
    const old=deferred<ReturnType<typeof journal>|null>();
    mocks.read.mockReturnValueOnce(old.promise).mockResolvedValue(journal('77','restored'));
    render(<RepositoryIdentityMigrationPanel/>);
    act(()=>{
      useAppStore.setState({user:user(88)});
      useAppStore.setState({user:user(77)});
    });
    await ready();
    await act(async()=>{old.resolve(journal());});
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button',{name:'Resume Migration'})).toBeNull();
    expect(mocks.read.mock.calls).toEqual([['77'],['77']]);
  });

  it.each(['resume','restore'] as const)('ignores stale %s errors and finally without clearing the new operation busy state',async(action)=>{
    const old=deferred<void>();
    const next=deferred<ReturnType<typeof preview>>();
    mocks.read.mockImplementation((account:string)=>Promise.resolve(account==='77' ? journal() : null));
    mocks[action==='resume' ? 'run' : 'restore'].mockReturnValue(old.promise);
    render(<RepositoryIdentityMigrationPanel/>);
    await screen.findByRole('button',{name:'Resume Migration'});
    fireEvent.click(action==='resume' ? resume() : restore());
    switchAccount(88);
    await ready();
    mocks.preview.mockReturnValue(next.promise);
    fireEvent.click(dryRun());
    expect(dryRun()).toBeDisabled();
    await act(async()=>{old.reject(new Error('OLD_ACCOUNT_FAILED'));});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(dryRun()).toBeDisabled();
    expect(mocks.read.mock.calls).toEqual([['77'],['88']]);
    await act(async()=>{next.resolve(preview('88','current/repo'));});
    await ready();
    expect(screen.getByText('current/repo')).toBeInTheDocument();
    expect(mocks.read.mock.calls).toEqual([['77'],['88'],['88']]);
  });

  it('ignores an old finally journal refresh that resolves after switching accounts',async()=>{
    const old=deferred<ReturnType<typeof journal>|null>();
    mocks.read.mockResolvedValueOnce(journal()).mockReturnValueOnce(old.promise).mockResolvedValue(null);
    render(<RepositoryIdentityMigrationPanel/>);
    await screen.findByRole('button',{name:'Resume Migration'});
    fireEvent.click(resume());
    await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));
    switchAccount(88);
    await ready();
    await act(async()=>{old.resolve(journal());});
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button',{name:'Resume Migration'})).toBeNull();
    expect(dryRun()).toBeEnabled();
  });

  it('ignores late initial journal failures after logout',async()=>{
    const old=deferred<ReturnType<typeof journal>|null>();
    mocks.read.mockReturnValue(old.promise);
    render(<RepositoryIdentityMigrationPanel/>);
    switchAccount(null);
    await act(async()=>{old.reject(new Error('OLD_JOURNAL_FAILED'));});
    expect(screen.queryByRole('alert')).toBeNull();
    expect(dryRun()).toBeDisabled();
  });

  it('does not refresh the journal after an unmounted dry-run finishes',async()=>{
    const old=deferred<ReturnType<typeof preview>>();
    mocks.preview.mockReturnValue(old.promise);
    const hook=render(<RepositoryIdentityMigrationPanel/>);
    await ready();
    fireEvent.click(dryRun());
    hook.unmount();
    await act(async()=>{old.resolve(preview());});
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

describe('RepositoryIdentityMigrationPanel same-account recovery',()=>{
  it.each(['resume','restore'] as const)('refreshes the same account journal after successful %s',async(action)=>{
    mocks.read.mockResolvedValueOnce(journal()).mockResolvedValue(journal('77',action==='resume' ? 'complete' : 'restored'));
    render(<RepositoryIdentityMigrationPanel/>);
    await screen.findByRole('button',{name:'Resume Migration'});
    fireEvent.click(action==='resume' ? resume() : restore());
    await ready();
    expect(mocks[action==='resume' ? 'run' : 'restore']).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.read.mock.calls).toEqual([['77'],['77']]);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('requires explicit selection and confirmation before applying mappings',async()=>{
    render(<RepositoryIdentityMigrationPanel/>);
    await ready();
    fireEvent.click(dryRun());
    const checkbox=await screen.findByRole('checkbox');
    await ready();
    expect(checkbox).not.toBeChecked();
    expect(apply()).toBeDisabled();
    expect(mocks.run).not.toHaveBeenCalled();
    fireEvent.click(checkbox);
    fireEvent.click(apply());
    await ready();
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith([{
      oldId:1_700_000_000_000,newId:99,fullName:'old/repo',
      evidence:'explicit user confirmation after identity dry-run',
    }]);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('does not restore when the confirmation is declined',async()=>{
    mocks.read.mockResolvedValue(journal());
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<RepositoryIdentityMigrationPanel/>);
    await screen.findByRole('button',{name:'Resume Migration'});
    fireEvent.click(restore());
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(resume()).toBeEnabled();
  });

  it('surfaces initial journal read failures without an unhandled rejection',async()=>{
    mocks.read.mockRejectedValue(new Error('JOURNAL_UNAVAILABLE'));
    render(<RepositoryIdentityMigrationPanel/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('JOURNAL_UNAVAILABLE');
    expect(dryRun()).toBeEnabled();
  });

  it('surfaces finally journal read failures and releases UI busy state',async()=>{
    mocks.read.mockResolvedValueOnce(journal()).mockRejectedValue(new Error('JOURNAL_REFRESH_FAILED'));
    render(<RepositoryIdentityMigrationPanel/>);
    await screen.findByRole('button',{name:'Resume Migration'});
    fireEvent.click(resume());
    expect(await screen.findByRole('alert')).toHaveTextContent('JOURNAL_REFRESH_FAILED');
    expect(resume()).toBeEnabled();
  });

  it.each(['resume','restore'] as const)('preserves %s failures when the final journal refresh also fails and permits retry',async(action)=>{
    mocks.read.mockResolvedValueOnce(journal()).mockRejectedValueOnce(new Error('JOURNAL_REFRESH_FAILED')).mockResolvedValue(journal());
    mocks[action==='resume' ? 'run' : 'restore'].mockRejectedValueOnce(new Error('OPERATION_FAILED')).mockResolvedValue(undefined);
    render(<RepositoryIdentityMigrationPanel/>);
    await screen.findByRole('button',{name:'Resume Migration'});
    fireEvent.click(action==='resume' ? resume() : restore());
    expect(await screen.findByRole('alert')).toHaveTextContent('OPERATION_FAILED');
    await waitFor(()=>expect(resume()).toBeEnabled());
    fireEvent.click(action==='resume' ? resume() : restore());
    await waitFor(()=>expect(mocks[action==='resume' ? 'run' : 'restore']).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(resume()).toBeEnabled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps complete journals with an error resumable',async()=>{
    mocks.read.mockResolvedValueOnce(journal('77','complete','HOME_RECONNECT_FAILED')).mockResolvedValue(journal('77','complete'));
    render(<RepositoryIdentityMigrationPanel/>);
    await screen.findByRole('button',{name:'Resume Migration'});
    fireEvent.click(resume());
    await ready();
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith();
    expect(screen.queryByRole('button',{name:'Resume Migration'})).toBeNull();
  });
});
