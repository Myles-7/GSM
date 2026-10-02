import runtime from './reader-runtime.txt?raw';
import style from './reader-style.txt?raw';
import { operationFields, type ReadingItem, type ReadingSnapshot } from './model';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const timeLabel = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）' : '未记录时间';
export function safeSourceUrl(value: string): string { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
const link = (label: string, url: string) => safeSourceUrl(url) ? `<a href="${escape(safeSourceUrl(url))}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : escape(label);
function card(item: ReadingItem, snapshot: ReadingSnapshot): string {
  const { fields, operations } = snapshot.settings;
  const toggle = (field: 'read' | 'candidate') => operations[field] ? `<label><input type="checkbox" data-repo="${item.id}" data-field="${field}">${operationFields[field]}</label>` : '';
  return `<article class="project" data-id="${item.id}"><span class="owner">${escape(item.name.split('/')[0])}</span><h3>${link(item.name, item.url)}</h3>
    ${item.summary ? `<p class="summary">${escape(item.summary)}</p>` : ''}
    ${item.description ? `<p class="muted">${escape(item.description)}</p>` : ''}
    <div class="tags">${item.tags.map(tag => `<span>${escape(tag)}</span>`).join('')}${item.category ? `<span>${escape(item.category)}</span>` : ''}</div>
    <div class="meta">${fields.language && item.language ? `<span>${escape(item.language)}</span>` : ''}${fields.stars ? `<span>☆ ${item.stars.toLocaleString('zh-CN')}</span>` : ''}${item.updated ? `<span>更新 ${escape(item.updated.slice(0,10))}</span>` : ''}</div>
    ${item.reason ? `<p>${escape(item.reason)}</p>` : ''}
    ${item.release ? `<details><summary>版本 ${escape(item.release.tag)} · ${escape(item.release.date.slice(0,10))}</summary><p class="content">${escape(item.release.text)}</p>${link('发布来源', item.release.url)}</details>` : ''}
    ${item.analysis.length ? `<details><summary>完整 AI 分析</summary>${item.analysis.map(section => `<h3>${escape(section.title)}</h3><p class="content">${escape(section.text)}</p>`).join('')}</details>` : ''}
    ${item.sources.length || item.generatedAt ? `<details><summary>查看依据</summary>${item.generatedAt ? `<p class="muted">分析生成于 ${escape(timeLabel(item.generatedAt))}</p>` : ''}${item.sources.map(source => `<p>${link(source.label, source.url)}</p>`).join('')}</details>` : ''}
    ${fields.notes && item.state.note ? `<p class="content">我的笔记：${escape(item.state.note)}</p>` : ''}
    ${Object.values(operations).some(Boolean) ? `<details><summary>阅读标记与笔记</summary><div class="controls">${toggle('read')}${toggle('candidate')}${operations.interest ? `<label>兴趣<select data-repo="${item.id}" data-field="interest"><option value="neutral">未标记</option><option value="interested">感兴趣</option><option value="ignored">忽略</option></select></label>` : ''}</div>${operations.note ? `<label class="note">阅读笔记<textarea maxlength="12000" data-repo="${item.id}" data-field="note" placeholder="写下用途、疑问或使用想法"></textarea></label>` : ''}</details>` : ''}
  </article>`;
}
export function renderReadingHtml(snapshot: ReadingSnapshot): string {
  const settings = snapshot.settings;
  const categories = [...new Map(snapshot.sections.filter(s=>s.id==='repositories').flatMap(s=>s.items).filter(i=>i.category).map(i=>[i.categoryId,i.category])).entries()];
  const payload = JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(snapshot.title)}</title><style>${style}</style></head>
  <body data-theme="${settings.theme}" data-density="${settings.density}" style="--size:${settings.fontSize}px"><header><h1>${escape(snapshot.title)}</h1><p class="muted">${escape(new Date(snapshot.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))} · 北京时间 · 离线阅读快照</p><p class="muted">只使用桌面已有摘要与分析。收藏候选须回桌面确认；文件不会调用 AI 或修改 GitHub。</p><noscript><p class="warning">当前预览不支持脚本，可阅读内容；搜索、标记及导出需要下载后使用浏览器打开。</p></noscript><p id="notice" role="status" class="warning" hidden></p></header>
  ${(snapshot.warnings??[]).map(warning=>`<p class="warning">${escape(warning)}</p>`).join('')}
  <div class="toolbar"><div class="toolbar-inner">${settings.repositories ? '<button data-page="repositories">仓库</button>' : ''}${settings.discovery ? '<button data-page="discovery">发现</button>' : ''}<input id="search" aria-label="搜索项目" placeholder="搜索项目名称、用途或标签"><select id="category" aria-label="分类"><option value="">所有分类</option>${categories.map(([id,name])=>`<option value="${escape(id)}">${escape(name)}</option>`).join('')}</select><button id="export">导出修改</button></div></div>
  <main>${snapshot.sections.map(section => `<section class="reading-section" data-section="${escape(section.id)}"><h2>${escape(section.title)} <small class="section-count">${section.items.length} 个项目</small></h2><p class="muted">${section.updatedAt ? `内容更新于 ${escape(timeLabel(section.updatedAt))}` : '未记录更新时间'}</p>${section.warning ? `<p class="warning">${escape(section.warning)}</p>` : ''}<div class="grid">${section.items.map(item=>card(item,snapshot)).join('')}</div><button class="load-more">显示更多项目</button></section>`).join('')}<p id="empty" hidden>没有匹配项目，试试其他关键词或分类。</p></main>
  <footer><p id="change-status" role="status"></p><p class="muted">本地浏览器保存可能受限制。关闭文件前导出修改；复制文本到桌面“每日 HTML”，或导入回传文件。未回传前电脑不知道你的阅读进度。</p><label class="restore">载入这份 HTML 的回传记录<input id="restore" type="file" accept="application/json,.json"></label></footer>
  <dialog id="return-dialog" aria-labelledby="export-title"><h2 id="export-title">带回桌面</h2><p>复制下面内容，在桌面设置 → 每日 HTML → 导入手机记录中粘贴。下载文件可作为备用。</p><textarea id="return-text" aria-label="回传文本" readonly></textarea><div class="export-actions"><button id="copy">复制文本</button><button id="download">下载回传文件</button><button id="close-export">关闭</button></div><p id="export-status" role="status"></p></dialog>
  <script id="gsm-data" type="application/json">${payload}</script><script>${runtime}</script></body></html>`;
}
