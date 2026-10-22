import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepositoryFacetWindow } from './RepositoryFacetWindow';
import { filterPreferencesKey, readFilterPreferences, saveFilterPreferences, defaultFilterPreferences } from './facetWindowPreferences';
import type { FacetSelection } from '../../../utils/classificationFacets';

const options = [
  { id: 'technology:react', group: 'technology' as const, label: 'React', count: 2 },
  { id: 'technology:python', group: 'technology' as const, label: 'Python', count: 1 },
  { id: 'platform:web', group: 'platform' as const, label: 'web', count: 3 },
];
function Fixture({ account = 'alice', available = options, resultCount = 3 }: { account?: string; available?: typeof options; resultCount?: number }) {
  const [selection, setSelection] = useState<FacetSelection>({});
  return <><button>Outside</button><RepositoryFacetWindow account={account} language="zh" options={available} selection={selection} onChange={setSelection} resultCount={resultCount} baseCount={3} breadcrumb={<span>All</span>} /></>;
}
const open = () => fireEvent.click(screen.getByRole('button', { name: /^特征筛选/ }));
const header = () => screen.getByRole('button', { name: '拖动特征筛选窗口，方向键移动' });
beforeEach(() => { localStorage.clear(); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 }); });

describe('RepositoryFacetWindow', () => {
  it('opens modeless, stays open on outside clicks, collapses without clearing choices, and restores focus', () => {
    render(<Fixture />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false');
    expect(header()).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'React 2' }));
    fireEvent.click(screen.getByRole('button', { name: '收起筛选窗口' }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除 React' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开筛选窗口' }));
    expect(screen.getByRole('checkbox', { name: 'React 2' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '关闭特征筛选' }));
    expect(screen.getByRole('button', { name: /^特征筛选/ })).toHaveFocus();
  });
  it('anchors first open and reset to the trigger, and the open trigger reveals and repositions the window', () => {
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: /^特征筛选/ });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ x: 800, y: 150, right: 900, bottom: 180, width: 100, height: 30, top: 150, left: 800, toJSON: () => ({}) });
    open();
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '520px', top: '188px' });
    fireEvent.keyDown(header(), { key: 'ArrowLeft', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: '收起筛选窗口' }));
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '520px', top: '188px' });
    expect(screen.getByRole('searchbox', { name: '技术 特征搜索' })).toBeInTheDocument();
    fireEvent.keyDown(header(), { key: 'ArrowLeft' });
    fireEvent.click(screen.getByRole('button', { name: '重置窗口位置' }));
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '520px', top: '188px' });
  });
  it('shows match count and a zero-result recovery hint, with removable chips inside hidden groups', () => {
    render(<Fixture resultCount={0} />); open();
    const dialog = screen.getByRole('dialog', { name: '特征筛选 0' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'React 2' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '技术' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义筛选' }));
    expect(within(dialog).getByRole('status')).toHaveTextContent('没有符合当前特征的仓库');
    expect(screen.queryByRole('searchbox', { name: '技术 特征搜索' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '移除 React（窗口内）' }));
    expect(screen.queryByRole('button', { name: '移除 React' })).not.toBeInTheDocument();
  });
  it('moves with keyboard, clamps on resize and resets position', () => {
    saveFilterPreferences('alice', { ...defaultFilterPreferences(), position: { x: 200, y: 100 } });
    render(<Fixture />); open();
    fireEvent.keyDown(header(), { key: 'ArrowRight' });
    fireEvent.keyDown(header(), { key: 'ArrowDown', shiftKey: true });
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '210px', top: '140px' });
    fireEvent.keyDown(header(), { key: 'ArrowLeft', shiftKey: true });
    expect(readFilterPreferences('alice').position).toEqual({ x: 170, y: 140 });
    act(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 }); window.dispatchEvent(new Event('resize')); });
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '12px', top: '108px' });
    fireEvent.click(screen.getByRole('button', { name: '重置窗口位置' }));
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '12px', top: '12px' });
  });
  it('drags by pointer and stops moving after cancellation', () => {
    saveFilterPreferences('alice', { ...defaultFilterPreferences(), position: { x: 100, y: 100 } });
    render(<Fixture />); open();
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { button: 0, pointerId: 7, clientX: x, clientY: y });
      fireEvent(header(), event);
    };
    pointer('pointerdown', 120, 120);
    pointer('pointermove', 170, 160);
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '150px', top: '140px' });
    pointer('pointercancel', 170, 160);
    pointer('pointermove', 900, 900);
    expect(screen.getByRole('dialog')).toHaveStyle({ left: '150px', top: '140px' });
  });
  it('lets Escape clear search, then exit customization, then close the window', () => {
    render(<Fixture />); open();
    fireEvent.click(screen.getByRole('button', { name: '自定义筛选' }));
    const search = screen.getByRole('searchbox', { name: '技术 特征搜索' });
    fireEvent.change(search, { target: { value: 'React' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(screen.getByRole('button', { name: '自定义筛选' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '自定义筛选' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(header(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('hides and reorders groups while keeping hidden selected chips removable', () => {
    render(<Fixture />); open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'React 2' }));
    fireEvent.click(screen.getByRole('button', { name: '自定义筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '技术' }));
    fireEvent.click(screen.getByRole('button', { name: '场景 上移' }));
    expect(readFilterPreferences('alice').groups).toEqual(['technology', 'scenario', 'platform']);
    fireEvent.click(screen.getByRole('button', { name: '自定义筛选' }));
    expect(screen.queryByRole('searchbox', { name: '技术 特征搜索' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除 React' }));
    expect(screen.queryByRole('button', { name: '移除 React' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '自定义筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复默认筛选布局' }));
    expect(readFilterPreferences('alice').hidden).toEqual([]);
    expect(readFilterPreferences('alice').groups).toEqual(['technology', 'platform', 'scenario']);
  });
  it('pins deduplicated favorites, orders them and keeps missing favorites disabled unless selected', () => {
    const view = render(<Fixture />); open();
    fireEvent.click(screen.getByRole('button', { name: '自定义筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '设为常用 React' }));
    fireEvent.click(screen.getByRole('button', { name: '设为常用 Python' }));
    expect(screen.getAllByRole('checkbox', { name: 'React 2' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Python 常用上移' }));
    expect(readFilterPreferences('alice').favorites.map(item => item.label)).toEqual(['Python', 'React']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'React 2' }));
    view.rerender(<Fixture available={[]} />);
    const favorites = within(screen.getByRole('region', { name: '常用特征' }));
    expect(favorites.getByRole('checkbox', { name: 'Python 0' })).toBeDisabled();
    expect(favorites.getByRole('checkbox', { name: 'React 0' })).toBeEnabled();
    fireEvent.click(favorites.getByRole('checkbox', { name: 'React 0' }));
    expect(favorites.getByRole('checkbox', { name: 'React 0' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '取消常用 Python' }));
    expect(readFilterPreferences('alice').favorites.map(item => item.label)).toEqual(['React']);
  });
  it('loads account-specific preferences and always reopens closed after account switches and remounts', () => {
    const view = render(<Fixture />); open();
    fireEvent.click(screen.getByRole('button', { name: '自定义筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '设为常用 React' }));
    view.rerender(<Fixture account="bob" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    expect(screen.queryByRole('region', { name: '常用特征' })).not.toBeInTheDocument();
    expect(localStorage.getItem(filterPreferencesKey('alice'))).toContain('React');
    view.unmount();
    render(<Fixture />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    expect(screen.getByRole('region', { name: '常用特征' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'React 2' })).not.toBeChecked();
  });
});
