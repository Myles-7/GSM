import { expect, it, vi } from 'vitest';
import { openReadingBrowserPreview, readingBrowserPreviewDocument } from './htmlReadingBrowserPreview';

it('runs the actual HTML inside an opaque sandbox and exposes the five viewport widths',()=>{
  const html='<!doctype html><script>localStorage.setItem("x","1")</script><p>实际内容</p>';
  const wrapper=readingBrowserPreviewDocument(html);
  const doc=new DOMParser().parseFromString(wrapper,'text/html');
  expect(doc.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts allow-downloads allow-popups');
  expect(doc.querySelector('iframe')?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  expect([...doc.querySelectorAll('[data-width]')].map(node=>node.getAttribute('data-width'))).toEqual(['360','390','430','768','1024']);
  expect(doc.querySelectorAll('script')).toHaveLength(1);
  expect(wrapper).toContain('window.opener=null');expect(wrapper).toContain('gsm-reading-preview-theme');expect(wrapper).toContain('\\u003cscript>');
});
it('opens only on an explicit call and removes opener access',()=>{
  vi.useFakeTimers();const open=vi.spyOn(window,'open').mockReturnValue(null);
  const create=vi.fn(()=> 'blob:controlled-preview');const revoke=vi.fn();
  vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:create,revokeObjectURL:revoke}));
  openReadingBrowserPreview('<p>preview</p>');expect(open).toHaveBeenCalledWith('blob:controlled-preview','_blank','noopener,noreferrer');
  vi.advanceTimersByTime(60_000);expect(revoke).toHaveBeenCalledWith('blob:controlled-preview');vi.useRealTimers();open.mockRestore();
});
