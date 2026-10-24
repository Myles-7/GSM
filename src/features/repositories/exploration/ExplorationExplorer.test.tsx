import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorationAccount } from './types';
import { accountFixture, repositoryFixture } from './testFixtures';
import { createSavedExploration } from './local';
const mocks = vi.hoisted(() => ({ account: null as ExplorationAccount | null, build: vi.fn(), deepen: vi.fn(), cancel: vi.fn(), add: vi.fn(), remove: vi.fn(), confirm: vi.fn(), owner: '42', storageFull: false, openTasks: vi.fn(), setupBlocked: false, configure: vi.fn(), refresh: vi.fn(), save:vi.fn(), toast:vi.fn() }));
const repositories = [repositoryFixture(1), repositoryFixture(2)];
vi.mock('../hooks/useExploration', () => ({ useExploration: () => ({ ownerId: mocks.owner, repositories, account: mocks.account, loading: false, error: mocks.storageFull ? 'AGY 调用恢复区额度已满' : '', recoveryStorageFull: mocks.storageFull, openTaskCenter: mocks.openTasks, busy: false,
  configId: 'model', setConfigId: vi.fn(), configs: [{ id: 'model', name: 'Test AI', model: 'test-model' }], config: { name: 'Test AI' }, changedCount: 0, canRun: !mocks.setupBlocked, setupIssue: mocks.setupBlocked ? 'AGY CLI 当前未启用，请完成保存并测试后启用' : '', configureAI: mocks.configure, refreshStatus: mocks.refresh,
  build: mocks.build, deepen: mocks.deepen, updateSaved:mocks.add, retry: vi.fn(), cancel: mocks.cancel, addOverride: mocks.add, removeOverride: mocks.remove, exportData: () => '{}', importData: vi.fn(), saveExploration:mocks.save, saveWorkspace:mocks.save,
}) }));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: mocks.confirm, toast:mocks.toast }) }));
import { ExplorationExplorer } from './ExplorationExplorer';
import { clearExplorationWorkspace } from '../hooks/useExplorationWorkspace';
beforeEach(() => { clearExplorationWorkspace(); localStorage.clear(); vi.clearAllMocks(); mocks.account = accountFixture(repositories, ['direct', 'similar']); mocks.owner = '42'; mocks.storageFull = false; mocks.setupBlocked = false; mocks.save.mockReset().mockResolvedValue(true); mocks.add.mockResolvedValue(true); mocks.confirm.mockResolvedValue(true); });

describe('project relationship exploration page', () => {
  it('restores the exploration path and selection after switching views without another AI call', () => {
    const first = render(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    expect(screen.getByRole('complementary', {name:'探索项目结果'})).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', {name:'探索主题'}), {target:{value:'Codex'}});
    fireEvent.click(screen.getByRole('button', {name:'探索'}));
    fireEvent.click(within(screen.getByRole('complementary', {name:'探索项目结果'})).getByRole('button', {name:/project-1/}));
    first.unmount();
    render(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    expect(screen.getByRole('combobox', {name:'探索主题'})).toHaveValue('Codex');
    expect(screen.getByRole('region', {name:'owner/project-1'})).toBeInTheDocument();
    expect(mocks.deepen).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled();
  });
  it('can manually deepen a saved snapshot even when no repository metadata has changed', () => {
    const item=createSavedExploration(mocks.account!,repositories,{name:'Saved Codex',query:'Codex',path:[{type:'entity',id:'entity:codex',label:'Codex'}],kindFilter:'all'});
    mocks.account!.saved=[item];render(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', {name:'工作区'}));
    fireEvent.click(screen.getByRole('button',{name:/^Saved Codex/}));
    const button=screen.getByRole('button',{name:'AI 深入探索'});expect(button).toBeEnabled();
    fireEvent.click(button);fireEvent.click(screen.getByRole('button',{name:'开始分析'}));expect(mocks.add).toHaveBeenCalledWith(item,true);
  });
  it('keeps the save dialog and typed name recoverable after a rejected save', async () => {
    mocks.save.mockRejectedValueOnce(new Error('private storage diagnostic'));
    render(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    fireEvent.change(screen.getByRole('combobox',{name:'探索主题'}),{target:{value:'Codex'}});
    fireEvent.click(screen.getByRole('button',{name:'探索'}));
    fireEvent.click(screen.getByRole('button',{name:'保存探索'}));
    fireEvent.change(screen.getByRole('textbox',{name:'探索名称'}),{target:{value:'My Codex'}});
    fireEvent.click(screen.getByRole('button',{name:'保存'}));
    await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith('未保存，请查看任务记录','error'));
    expect(screen.getByRole('textbox',{name:'探索名称'})).toHaveValue('My Codex');
    expect(screen.getByRole('button',{name:'保存'})).toBeEnabled();
    expect(screen.queryByText('private storage diagnostic')).not.toBeInTheDocument();
  });
  it('opens AI setup when exploration is requested with an unavailable model instead of leaving a dead button', () => {
    mocks.setupBlocked=true;render(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    fireEvent.change(screen.getByRole('combobox',{name:'探索主题'}),{target:{value:'Codex'}});
    const button=screen.getByRole('button',{name:'AI 深入探索'});expect(button).toBeEnabled();
    fireEvent.click(button);expect(mocks.configure).toHaveBeenCalledOnce();expect(mocks.deepen).not.toHaveBeenCalled();
  });
  it('allows exporting saved snapshots before a full index has been published', async () => {
    mocks.account!.saved = [createSavedExploration(mocks.account!, repositories, { name:'Snapshot', query:'', path:[{type:'all'}], kindFilter:'all' })];
    mocks.account!.task = { id:'partial',type:'build',status:'failed',startedAt:'now',model:'test',fingerprint:'fp',completed:1,total:2,draft:{'1':mocks.account!.index!.profiles['1']} };
    mocks.account!.index = null;
    render(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('button', { name:'图谱操作' }), { key:'Enter', code:'Enter' });
    expect(await screen.findByRole('menuitem', { name:'导出本机图谱' })).not.toHaveAttribute('aria-disabled', 'true');
  });
  it('allows manual query enhancement while an incomplete map checkpoint is preserved',()=>{
    mocks.account!.task={id:'partial',type:'build',status:'failed',startedAt:'now',model:'test',fingerprint:'fp',completed:1,total:2,draft:{'1':mocks.account!.index!.profiles['1']}};
    mocks.account!.index=null;render(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    fireEvent.change(screen.getByRole('combobox',{name:'探索主题'}),{target:{value:'Codex'}});
    expect(screen.getByRole('button',{name:'AI 深入探索'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'AI 深入探索'}));fireEvent.click(screen.getByRole('button',{name:'开始分析'}));expect(mocks.deepen).toHaveBeenCalledWith('Codex');
  });
  it('asks for an ambiguous object before sending a manually requested AI exploration',()=>{
    mocks.account!.index!.profiles['2'].entities.push({id:'different-codex',label:'另一种 Codex',aliases:['Codex'],description:'同名对象'});
    render(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    fireEvent.change(screen.getByRole('combobox',{name:'探索主题'}),{target:{value:'Codex'}});
    fireEvent.click(screen.getByRole('button',{name:'AI 深入探索'}));fireEvent.click(screen.getByRole('button',{name:'开始分析'}));
    expect(mocks.deepen).not.toHaveBeenCalled();expect(screen.getByText('请选择你要探索的对象')).toBeInTheDocument();
  });
  it('blocks building when AGY is disabled and offers setup and a read-only state refresh', () => {
    mocks.account = null; mocks.setupBlocked = true; render(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/保存并测试后启用/)).not.toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: /建立项目地图/ })) expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '前往 AI 设置' })); expect(mocks.configure).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重新检查状态' })); expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.build).not.toHaveBeenCalled(); expect(mocks.deepen).not.toHaveBeenCalled();
  });
  it('offers the recovery task center without silently retrying or deleting pending results', () => {
    mocks.storageFull = true; render(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    expect(screen.queryByText('AGY 调用恢复区额度已满')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开 AI 任务中心' })); expect(mocks.openTasks).toHaveBeenCalledOnce();
    expect(mocks.build).not.toHaveBeenCalled(); expect(mocks.deepen).not.toHaveBeenCalled();
  });
  it('has a manual onboarding without old views, fake clusters, confidence or automatic AI calls', () => {
    mocks.account = null; render(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    expect(screen.getByRole('button', { name: /建立项目地图 · 2/ })).toBeInTheDocument();
    expect(screen.queryByText(/用途聚类|主题星系|簇团地图|置信度/)).not.toBeInTheDocument();
    expect(mocks.build).not.toHaveBeenCalled(); expect(mocks.deepen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /建立项目地图 · 2/ })); expect(mocks.build).toHaveBeenCalledOnce();
  });
  it('shows saved first-build progress as an explicit partial preview without replacing the published index', () => {
    const draft = mocks.account!.index!.profiles;
    mocks.account!.index = null;
    mocks.account!.task = { id: 'partial', type: 'build', status: 'failed', startedAt: '2026-10-20T00:00:00Z', model: 'test', fingerprint: 'source', total: 368, completed: 2, draft };
    render(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    expect(screen.getByLabelText('地图任务状态')).toHaveTextContent('2 / 368 已保存');
    expect(screen.queryByText(/未完成的项目暂用/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '任务记录' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '探索项目结果' })).toHaveTextContent('project-1');
    expect(screen.getByRole('button', { name: '继续剩余 366 项' })).toBeInTheDocument(); expect(mocks.account!.index).toBeNull();
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it('shows representative repositories and a same-screen result list, then navigates a purpose topic', () => {
    render(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    expect(screen.getByRole('complementary', { name: '探索项目结果' })).toHaveTextContent('project-1');
    const map = screen.getByRole('region', { name: '项目关系地图' });
    expect(within(map).queryByTitle('owner/project-1')).not.toBeInTheDocument();
    fireEvent.click(within(map).getByRole('button', {name:'AI 与智能体 2 个项目'}));
    fireEvent.click(within(map).getByRole('button', { name: '编程智能体 2 个项目' }));
    expect(screen.getByRole('navigation', { name: '探索路径' })).toHaveTextContent('全库主题/AI 与智能体/编程智能体');
    expect(screen.getByRole('button', { name: '主题改名' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回' })); expect(screen.getByRole('navigation')).not.toHaveTextContent('编程智能体');
  });
  it('searches Codex locally, separates directions, and only deepens on explicit request', () => {
    render(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: '探索主题' }), { target: { value: 'Codex' } });
    expect(mocks.deepen).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '探索' }));
    expect(screen.getByRole('navigation')).toHaveTextContent('Codex'); expect(screen.getByRole('complementary', { name: '探索项目结果' })).toHaveTextContent('直接相关'); expect(screen.getByRole('complementary', { name: '探索项目结果' })).toHaveTextContent('同类能力');
    fireEvent.click(screen.getByRole('button', { name: 'AI 深入探索' })); fireEvent.click(screen.getByRole('button',{name:'开始分析'})); expect(mocks.deepen).toHaveBeenCalledWith('Codex');
    fireEvent.click(within(screen.getByRole('region', { name: '项目关系地图' })).getByRole('button',{name:'直接相关 直接相关 1 个项目'}));
    fireEvent.click(within(screen.getByRole('region', { name: '项目关系地图' })).getByRole('button', { name: '直接相关 技能与工作流 1 个项目' }));
    expect(screen.getByRole('navigation')).toHaveTextContent('技能与工作流'); expect(screen.getByRole('complementary', { name: '探索项目结果' })).not.toHaveTextContent('project-2');
  });
  it('opens a docked project inspector, reuses full details and exposes evidence and correction', () => {
    const open = vi.fn(); render(<ExplorationExplorer onOpenRepository={open} />);
    fireEvent.change(screen.getByRole('combobox', { name: '探索主题' }), { target: { value: 'Codex' } }); fireEvent.click(screen.getByRole('button', { name: '探索' }));
    fireEvent.click(within(screen.getByRole('complementary', { name: '探索项目结果' })).getByRole('button', { name: /project-1/ }));
    const card = screen.getByRole('region', { name: 'owner/project-1' }); expect(card).toHaveClass('explore-project-popover');
    expect(within(card).getByText('This tool supports Codex workflows.')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: '这条关系不成立' })); expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'remove-relation' }));
    fireEvent.click(within(card).getByRole('button', { name: '完整详情' })); expect(open).toHaveBeenCalledWith(repositories[0]);
  });
  it('supports local topic renaming, saved multi-membership and account scope reset', async () => {
    const view = render(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: '探索主题' }), { target: { value: '编程智能体' } }); fireEvent.click(screen.getByRole('option', { name: '编程智能体' }));
    fireEvent.click(screen.getByRole('button', { name: '主题改名' })); fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '代码助手' } }); fireEvent.click(screen.getByRole('button', { name: '保存主题名称' }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'rename-topic', label: '代码助手' })));
    mocks.owner = '99'; mocks.account = null; view.rerender(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: '探索主题' })).toHaveValue(''); expect(screen.queryByRole('navigation', { name: '探索路径' })).not.toBeInTheDocument();
  });
  it('keeps every theme available on a narrow canvas instead of silently truncating it', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 380, height: 400, x: 0, y: 0, top: 0, left: 0, bottom: 400, right: 380, toJSON: () => ({}) }));
    const original = mocks.account!.index!.profiles['1'].topics[0];
    mocks.account!.index!.profiles['1'].topics = Array.from({ length: 6 }, (_, index) => ({ ...original, id: `topic-${index}`, label: `用途主题 ${index}` }));
    const view = render(<ExplorationExplorer onOpenRepository={vi.fn()} />);
    const map = screen.getByRole('region', { name: '项目关系地图' });
    expect(map.querySelectorAll('.node-topic')).toHaveLength(2); // Browsing groups, with all underlying topics reachable.
    expect(within(map).getByRole('button', { name: '全部主题 (7)' })).toBeInTheDocument();
    expect(within(map).getByRole('button', { name: '全屏查看地图' })).toBeInTheDocument();
    view.unmount(); rect.mockRestore();
  });
});

describe('workspace persistence and manual save boundaries',()=>{
  it('updates the same workspace id, leaves it dirty after failure and never starts AI',async()=>{
    const item={version:1 as const,id:'live',name:'My workspace',query:'Codex',path:[{type:'all' as const},{type:'search' as const,id:'query',label:'Codex'}],kindFilter:'all' as const,createdAt:'now',updatedAt:'now'};
    mocks.account!.workspaces=[item];mocks.save.mockResolvedValue(true);
    const view=render(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'工作区'}));
    fireEvent.click(screen.getByRole('button',{name:/My workspace/}));
    fireEvent.change(screen.getByRole('combobox',{name:'探索主题'}),{target:{value:'browser'}});
    fireEvent.click(screen.getByRole('button',{name:'探索'}));
    expect(screen.getByText(/My workspace · 未保存/)).toBeInTheDocument();
    mocks.save.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button',{name:'保存探索'}));
    await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith('未保存，请查看任务记录','error'));
    expect(screen.getByText(/My workspace · 未保存/)).toBeInTheDocument();
    mocks.save.mockImplementationOnce(async value=>{mocks.account!.workspaces=[value];return true;});
    fireEvent.click(screen.getByRole('button',{name:'保存探索'}));
    await waitFor(()=>expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({id:'live',query:'browser'})));
    view.rerender(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    expect(mocks.account!.workspaces).toHaveLength(1);
    expect(mocks.deepen).not.toHaveBeenCalled();expect(mocks.build).not.toHaveBeenCalled();
  });
  it('guards workspace switches and cancel preserves the draft',()=>{
    mocks.account!.workspaces=[{version:1,id:'live',name:'My workspace',query:'',path:[{type:'all'}],kindFilter:'all',createdAt:'now',updatedAt:'now'}];
    render(<ExplorationExplorer onOpenRepository={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'工作区'}));fireEvent.click(screen.getByRole('button',{name:/My workspace/}));
    fireEvent.change(screen.getByRole('combobox',{name:'探索主题'}),{target:{value:'draft'}});fireEvent.click(screen.getByRole('button',{name:'探索'}));
    fireEvent.click(screen.getByRole('button',{name:'工作区'}));fireEvent.click(screen.getByRole('button',{name:'新建探索工作区'}));
    expect(screen.getByRole('button',{name:'保存并离开'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'取消'}));expect(screen.getByRole('combobox',{name:'探索主题'})).toHaveValue('draft');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
