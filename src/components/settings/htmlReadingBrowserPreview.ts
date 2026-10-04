/** Controlled wrapper; generated HTML only runs in an opaque sandbox origin. */
export function readingBrowserPreviewDocument(html: string): string {
  const payload = JSON.stringify(html).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>每日 HTML · 独立预览</title><style>body{margin:0;background:#e5e7eb;color:#111827;font:14px system-ui}header{position:sticky;top:0;padding:12px;background:#fff;display:flex;flex-wrap:wrap;align-items:center;gap:8px}button{padding:7px;border:1px solid #aaa;border-radius:6px;background:#fff;cursor:pointer}main{padding:12px;overflow:auto}iframe{display:block;margin:auto;width:390px;height:calc(100vh - 100px);min-height:400px;border:0;background:#fff}</style><header><strong>独立预览 · 标记不进入正式记录</strong><span>宽度</span>${[360,390,430,768,1024].map(width => `<button data-width="${width}">${width}px</button>`).join('')}<button data-theme="light">预览浅色</button><button data-theme="dark">预览深色</button></header><main><iframe title="每日 HTML 预览" sandbox="allow-scripts allow-downloads allow-popups"></iframe></main><script>window.opener=null;const frame=document.querySelector('iframe');frame.srcdoc=${payload};document.querySelectorAll('[data-width]').forEach(button=>button.onclick=()=>{frame.style.width=button.dataset.width+'px'});document.querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>{frame.contentWindow.postMessage({type:'gsm-reading-preview-theme',theme:button.dataset.theme},'*')});</script></html>`;
}

export function openReadingBrowserPreview(html: string): void {
  const url = URL.createObjectURL(new Blob([readingBrowserPreviewDocument(html)], { type: 'text/html;charset=utf-8' }));
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadReadingPreview(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gsm-reading-preview.html';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
