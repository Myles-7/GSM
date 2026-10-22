import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExplorationTaskStatus } from './ExplorationTaskStatus';
import type { ExplorationTask } from './types';
import { describeAgyRecoveryError } from '../../../services/agyErrors';

const task: ExplorationTask = { id:'partial',type:'build',status:'failed',startedAt:'2026-10-21T02:32:00Z',model:'config:model',fingerprint:'fp',completed:358,total:368,draft:{},error:'AGY_TIMEOUT; AGY_TIMEOUT',
  failures:[{repositoryIds:[359,360,361,362,363],message:'AGY_TIMEOUT',unknown:true},{repositoryIds:[364,365,366,367,368],message:'AGY_TIMEOUT',unknown:true}] };
function props() { return {ownerId:'42',task,busy:false,error:task.error!,message:'',preview:true,readyCount:364,model:'AGY CLI',elapsed:0,concurrency:5,activity:'',canRun:true,recoveryStorageFull:false,
  onRetry:vi.fn(),onCancel:vi.fn(),onTasks:vi.fn(),onConfigure:vi.fn(),onRefresh:vi.fn()}; }
describe('compact exploration task status',()=>{
  it('keeps failure details off the page and routes users to task records',()=>{
    const input={...props(),error:describeAgyRecoveryError(task.error!)};render(<ExplorationTaskStatus {...input}/>);
    expect(screen.getByLabelText('地图任务状态')).toHaveTextContent('358 / 368 已保存');
    expect(screen.queryByText(/超时|AGY_TIMEOUT|任务未完成/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前 364/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'继续剩余 10 项'}));expect(input.onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'任务记录'}));
    expect(input.onTasks).toHaveBeenCalledOnce();
    expect(screen.queryByText(/AGY 已发送请求/)).not.toBeInTheDocument();
  });
  it('keeps the account change free of old diagnostics and preserves topic-only retry',()=>{
    const input=props();const view=render(<ExplorationTaskStatus {...input}/>);
    expect(screen.queryByRole('button',{name:'展开任务详情'})).not.toBeInTheDocument();
    view.rerender(<ExplorationTaskStatus {...input} ownerId="99" task={{...task,id:'topics',phase:'topics',total:358,failures:[]}}/>);
    expect(screen.queryByRole('button',{name:'展开任务详情'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'重试主题整理'})).toBeInTheDocument();
    expect(input.onRetry).not.toHaveBeenCalled();
  });
});
