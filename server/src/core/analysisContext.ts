

function excerptLines(lines: string[], budget: number): string {
  const selected: string[] = [];
  let length = 0;
  let fence: string | null = null;
  let fenceStart = -1;
  for (const line of lines) {
    if (length + line.length + 1 > budget) break;
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) { fence = delimiter[1]; fenceStart = selected.length; }
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
    }
    selected.push(line);
    length += line.length + 1;
  }
  // Never turn a truncated command or half a code block into installation advice.
  if (fence) selected.splice(fenceStart);
  return selected.join('\n').trim();
}

/** Retain source wording so downstream command and quote checks remain literal. */
export function selectAnalysisContext(markdown: string, maxChars = 12_000): string {
  if (!markdown.trim() || maxChars <= 0) return '';
  const sections: Array<{ lines: string[]; score: number; order: number }> = [];
  let current = { lines: [] as string[], score: 3, order: 0 };
  let fence: string | null = null;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
    }
    if (!fence && /^#{1,6}\s/.test(line)) {
      if (current.lines.length) sections.push(current);
      const score = /sponsor|badge|donat|contribut|赞助|捐赠/i.test(line) ? -1
        : /feature|install|quick.?start|usage|limit|support|requirement|compatib|overview|about|功能|安装|使用|限制|支持|简介|兼容/i.test(line) ? 4 : 1;
      current = { lines: [], score, order: sections.length };
    }
    if (!fence && /^\s*(?:\[?!\[.*(?:shields\.io|badge)|<img.*(?:shields\.io|badge))/i.test(line)) continue;
    current.lines.push(line);
  }
  if (current.lines.length) sections.push(current);
  const useful = sections.filter(section => section.score >= 0);
  if (useful.reduce((n, s) => n + s.lines.join('\n').length + 2, 0) <= maxChars)
    return useful.map(section => section.lines.join('\n')).join('\n\n').trim();
  const ranked = [...useful].sort((a, b) => b.score - a.score || a.order - b.order);
  let remaining = maxChars;
  const selected: Array<{ text: string; order: number }> = [];
  const allowance = Math.max(256, Math.floor(maxChars / Math.min(8, ranked.length || 1)));
  for (const section of ranked) {
    if (remaining < 32) break;
    const text = excerptLines(section.lines, Math.min(allowance, remaining - 2));
    if (text.trim()) { selected.push({ text, order: section.order }); remaining -= text.length + 2; }
  }
  return selected.sort((a, b) => a.order - b.order).map(section => section.text).join('\n\n');
}


