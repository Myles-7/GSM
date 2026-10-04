import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HtmlReadingMail } from './HtmlReadingMail';
import { defaultSettings } from '../../lib/html-reading/model';
import type { useHtmlReading } from '../../features/settings/hooks/useHtmlReading';

beforeEach(()=>{window.electronAPI={htmlReading:{resend:vi.fn()}} as unknown as Window['electronAPI'];});
function controller(dirty=false) {
  return {account:'42',settings:{...defaultSettings,title:dirty?'未保存标题':defaultSettings.title},saved:defaultSettings,mail:{credential:{accountId:'42',from:'from@gmail.com',to:'to@example.test',configured:true},runs:[]},generate:vi.fn(),resend:vi.fn(),setSettings:vi.fn(),busy:false} as unknown as ReturnType<typeof useHtmlReading>;
}
it.each([['保存并发送','save'],['使用已保存配置发送','saved']])('requires a concrete dirty send choice: %s',(label,configuration)=>{
  const c=controller(true);render(<HtmlReadingMail controller={c}/>);
  fireEvent.click(screen.getByRole('button',{name:'立即生成并发送'}));
  expect(c.generate).not.toHaveBeenCalled();expect(screen.getByRole('group',{name:'选择发送配置'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:label}));expect(c.generate).toHaveBeenCalledWith('send',false,configuration);
});
it('sends clean settings without another choice',()=>{
  const c=controller();render(<HtmlReadingMail controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'立即生成并发送'}));expect(c.generate).toHaveBeenCalledWith('send',false,'current');
});
it('requires checking the inbox before resending an unconfirmed stored attachment',()=>{
  const c=controller();c.mail.runs=[{id:'run',accountId:'42',kind:'manual',date:'2026-10-04',startedAt:'2026-10-04T00:00:00Z',status:'unconfirmed',hasAttachment:true,retryCount:2,phase:'verifying'}];
  render(<HtmlReadingMail controller={c}/>);expect(screen.getByText('阶段：验证连接')).toBeInTheDocument();expect(screen.getByText('已重试 2 次')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'补发保存的附件'}));expect(c.resend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'已检查收件箱，确认补发'}));expect(c.resend).toHaveBeenCalledWith('run',true);
});
it.each(['立即生成并发送','重新生成并发送'])('requires checking the inbox before replacement generation via %s',label=>{
  const c=controller();c.mail.runs=[{id:'run',accountId:'42',kind:'manual',date:'2026-10-04',startedAt:'2026-10-04T00:00:00Z',status:'unconfirmed'}];
  render(<HtmlReadingMail controller={c}/>);fireEvent.click(screen.getByRole('button',{name:label}));
  expect(c.generate).not.toHaveBeenCalled();expect(screen.getByRole('group',{name:'确认重新发送未确认邮件'})).toHaveTextContent('请先检查收件箱');
  fireEvent.click(screen.getByRole('button',{name:'已检查收件箱，确认生成并发送'}));expect(c.generate).toHaveBeenCalledWith('send',false,'current');
});
it.each([['保存并发送','save'],['使用已保存配置发送','saved']])('also confirms an unconfirmed latest send after choosing %s',(label,configuration)=>{
  const c=controller(true);c.mail.runs=[{id:'run',accountId:'42',kind:'manual',date:'2026-10-04',startedAt:'2026-10-04T00:00:00Z',status:'unconfirmed'}];
  render(<HtmlReadingMail controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'立即生成并发送'}));fireEvent.click(screen.getByRole('button',{name:label}));
  expect(c.generate).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'已检查收件箱，确认生成并发送'}));expect(c.generate).toHaveBeenCalledWith('send',false,configuration);
});
it('does not generate when the replacement confirmation is cancelled',()=>{
  const c=controller();c.mail.runs=[{id:'run',accountId:'42',kind:'manual',date:'2026-10-04',startedAt:'2026-10-04T00:00:00Z',status:'unconfirmed'}];
  render(<HtmlReadingMail controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'立即生成并发送'}));fireEvent.click(screen.getByRole('button',{name:'取消重新发送'}));expect(c.generate).not.toHaveBeenCalled();
});
it.each([['generation','生成附件'],['verification','验证连接'],['submission','提交邮件'],['accepted','Gmail 已接受']])('translates the actual service phase %s and shows genuine timestamps',(phase,label)=>{
  const c=controller();c.mail.runs=[{id:'run',accountId:'42',kind:'manual',date:'2026-10-04',startedAt:'2026-10-04T00:00:00Z',completedAt:'2026-10-04T00:03:00Z',status:'accepted',phase}];
  render(<HtmlReadingMail controller={c}/>);expect(screen.getByText(`阶段：${label}`)).toBeInTheDocument();
  expect(screen.getByText(/开始准备：/)).toHaveTextContent('08:00:00');expect(screen.getByText(/Gmail 接受：/)).toHaveTextContent('08:03:00');
});
it('shows live progress only while generating and preserves the actual attachment generation timestamp on resend',()=>{
  const c=controller();c.mail.runs=[{id:'run',accountId:'42',kind:'manual',date:'2026-10-04',startedAt:'2026-10-04T00:00:00Z',generatedAt:'2026-10-04T00:02:00Z',status:'generating',progress:'正在准备趋势频道 · 60 项'}];
  const {rerender}=render(<HtmlReadingMail controller={c}/>);
  expect(screen.getByRole('status')).toHaveTextContent('正在准备趋势频道 · 60 项');
  expect(screen.getByText(/开始准备：/)).toHaveTextContent('08:00:00');expect(screen.getByText(/附件生成：/)).toHaveTextContent('08:02:00');
  c.mail.runs[0]={...c.mail.runs[0],status:'sent',startedAt:'2026-10-04T01:00:00Z',completedAt:'2026-10-04T01:01:00Z'};rerender(<HtmlReadingMail controller={c}/>);
  expect(screen.queryByText('正在准备趋势频道 · 60 项')).not.toBeInTheDocument();expect(screen.getByText(/附件生成：/)).toHaveTextContent('08:02:00');expect(screen.getByText(/Gmail 接受：/)).toHaveTextContent('09:01:00');
});
