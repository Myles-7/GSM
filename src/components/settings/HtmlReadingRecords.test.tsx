import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { HtmlReadingRecords } from './HtmlReadingRecords';
import type { ReadingData } from '../../lib/html-reading/storage';

function data() {
  return { names: Object.fromEntries(Array.from({ length: 121 }, (_, index) => [String(index + 1), `acme/tool-${index + 1}`])), states: Object.fromEntries(Array.from({ length: 121 }, (_, index) => [String(index + 1), { read: index === 120, candidate: true, interest: 'neutral', note: index === 120 ? 'unique note' : '' }])) } as unknown as ReadingData;
}
it('pages all records and searches saved notes beyond the old 100 item limit', () => {
  render(<HtmlReadingRecords data={data()} busy={false} onSave={vi.fn(async () => true)} />);
  expect(screen.getAllByRole('link')).toHaveLength(40); expect(screen.queryByRole('textbox', { name: /阅读笔记/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索阅读记录' }), { target: { value: 'unique note' } });
  expect(screen.getByRole('link', { name: 'acme/tool-121' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '未读' })); expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('requires explicit note save and preserves the draft when saving fails', async () => {
  const save = vi.fn(async () => false); render(<HtmlReadingRecords data={data()} busy={false} onSave={save} />);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索阅读记录' }), { target: { value: 'unique note' } });
  fireEvent.click(screen.getByText('阅读笔记（11 字）'));
  fireEvent.click(screen.getByRole('button', { name: '编辑笔记' }));
  const input = screen.getByRole('textbox', { name: '阅读笔记 acme/tool-121' }); fireEvent.change(input, { target: { value: 'preserved draft' } }); fireEvent.blur(input);
  expect(save).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('草稿已保留'));
  expect(input).toHaveValue('preserved draft');
  save.mockResolvedValue(true); fireEvent.click(screen.getByRole('button', { name: '保存笔记' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '阅读笔记 acme/tool-121' })).not.toBeInTheDocument());
});

it('locks the note being saved, prevents duplicate saves, and restores a failed draft',async()=>{
  let finish!:(value:boolean)=>void;
  const pending=new Promise<boolean>(resolve=>{finish=resolve;});
  const save=vi.fn(()=>pending);render(<HtmlReadingRecords data={data()} busy={false} onSave={save}/>);
  fireEvent.change(screen.getByRole('textbox',{name:'搜索阅读记录'}),{target:{value:'unique note'}});
  fireEvent.click(screen.getByText('阅读笔记（11 字）'));fireEvent.click(screen.getByRole('button',{name:'编辑笔记'}));
  const input=screen.getByRole('textbox',{name:'阅读笔记 acme/tool-121'});
  fireEvent.change(input,{target:{value:'pending draft'}});const button=screen.getByRole('button',{name:'保存笔记'});fireEvent.click(button);
  expect(input).toBeDisabled();expect(button).toBeDisabled();
  fireEvent.click(button);fireEvent.change(input,{target:{value:'changed while pending'}});
  expect(save).toHaveBeenCalledOnce();expect(save).toHaveBeenCalledWith('121','note','pending draft');expect(input).toHaveValue('pending draft');
  await act(async()=>finish(false));
  expect(input).toBeEnabled();expect(button).toBeEnabled();expect(input).toHaveValue('pending draft');expect(screen.getByRole('alert')).toHaveTextContent('草稿已保留');
});
