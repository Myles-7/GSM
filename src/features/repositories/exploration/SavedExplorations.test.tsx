import { fireEvent,render,screen,within } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { SavedExplorations } from './SavedExplorations';
import { accountFixture,repositoryFixture } from './testFixtures';
import { createSavedExploration } from './local';
import type { ExplorationWorkspace } from './types';

const workspace:ExplorationWorkspace={version:1,id:'shared-id',name:'codex',query:'codex',path:[{type:'all'}],kindFilter:'all',createdAt:'2026-01-01',updatedAt:'2026-10-24'};
function props(){return {workspaces:[workspace],snapshots:[],selected:'workspace:shared-id',atHome:false,busy:false,onOpen:vi.fn(),onHome:vi.fn(),onNew:vi.fn(),onRename:vi.fn(),onDelete:vi.fn(),onConvert:vi.fn()};}
function snapshot(){const repo=repositoryFixture(1);return {...createSavedExploration(accountFixture([repo]),[repo],{name:'Historical Codex',query:'legacy query',path:[{type:'all'}],kindFilter:'all'}),id:'shared-id'};}
describe('one saved exploration library',()=>{
  it('counts live explorations and never shows a contradictory empty snapshot section',()=>{
    const input=props();render(<SavedExplorations {...input}/>);
    expect(screen.getByRole('heading',{name:'已保存探索 1'})).toBeInTheDocument();
    expect(screen.queryByText('暂无保存的探索')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading',{name:'历史快照'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'全库地图'})).toHaveAttribute('aria-pressed','false');
    const open=screen.getByRole('button',{name:/^codex 随仓库更新/});
    expect(open).toHaveAttribute('aria-pressed','true');fireEvent.click(open);
    expect(input.onOpen).toHaveBeenCalledWith({kind:'workspace',item:workspace});
  });
  it('mixes both record types, filters by query and distinguishes colliding IDs',()=>{
    const old=snapshot(),input={...props(),snapshots:[old]};render(<SavedExplorations {...input}/>);
    expect(screen.getByRole('heading',{name:'已保存探索 2'})).toBeInTheDocument();
    const oldButton=screen.getByRole('button',{name:/^Historical Codex/});
    expect(oldButton).toHaveAttribute('aria-pressed','false');fireEvent.click(oldButton);
    expect(input.onOpen).toHaveBeenCalledWith({kind:'snapshot',item:old});
    fireEvent.change(screen.getByRole('textbox',{name:'搜索已保存探索'}),{target:{value:'legacy query'}});
    expect(screen.queryByRole('button',{name:/^codex 随仓库更新/})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:/^Historical Codex/})).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox',{name:'搜索已保存探索'}),{target:{value:'not found'}});
    expect(screen.getByText('没有匹配的已保存探索')).toBeInTheDocument();
    expect(screen.queryByText('暂无保存的探索')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'清空筛选'}));
    expect(screen.getByRole('button',{name:/^codex 随仓库更新/})).toBeInTheDocument();
  });
  it('uses the same actions for both types and only offers conversion for snapshots',async()=>{
    const old=snapshot(),input={...props(),snapshots:[old]};render(<SavedExplorations {...input}/>);
    const menu=screen.getByRole('button',{name:'更多操作：codex'});
    fireEvent.keyDown(menu,{key:'Enter',code:'Enter'});
    fireEvent.click(await screen.findByRole('menuitem',{name:'重命名'}));
    expect(input.onRename).toHaveBeenCalledWith({kind:'workspace',item:workspace});
    fireEvent.keyDown(screen.getByRole('button',{name:'更多操作：Historical Codex'}),{key:'Enter',code:'Enter'});
    fireEvent.click(await screen.findByRole('menuitem',{name:'另存为动态探索'}));
    expect(input.onConvert).toHaveBeenCalledWith(old);expect(input.onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(menu,{key:'Enter',code:'Enter'});
    fireEvent.click(await screen.findByRole('menuitem',{name:'删除探索'}));
    expect(input.onDelete).toHaveBeenCalledWith({kind:'workspace',item:workspace});
  });
  it('disables writes while busy without preventing navigation',()=>{
    const input={...props(),busy:true};render(<SavedExplorations {...input}/>);
    expect(screen.getByRole('button',{name:'更多操作：codex'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'新建探索'}));expect(input.onNew).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'全库地图'}));expect(input.onHome).toHaveBeenCalledOnce();
  });
  it('has one empty state and a truthful library selection',()=>{
    render(<SavedExplorations {...props()} workspaces={[]} selected="" atHome/>);
    expect(within(screen.getByRole('region',{name:'已保存探索'})).getByText('暂无保存的探索')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'全库地图'})).toHaveAttribute('aria-pressed','true');
    expect(screen.queryByRole('textbox',{name:'搜索已保存探索'})).not.toBeInTheDocument();
  });
});
