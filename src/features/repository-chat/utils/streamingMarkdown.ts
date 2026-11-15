const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function pendingInlineCode(line: string): number {
  let open: { index: number; length: number } | undefined;
  for (const match of line.matchAll(/`+/g)) {
    const index = match.index ?? 0;
    if (!open && /(?:^|[^\\])(?:\\\\)*\\$/.test(line.slice(0, index))) continue;
    if (!open) open = { index, length: match[0].length };
    else if (match[0].length === open.length) open = undefined;
  }
  return open?.index ?? line.length;
}

/** Complete only the preview so a partially received fence cannot flash as prose. */
export function stabilizeStreamingMarkdown(content: string): string {
  const lines = content.split('\n');
  let fence = '';
  for (const line of lines) {
    const marker = FENCE.exec(line);
    if (!marker) continue;
    if (!fence) fence = marker[1];
    else if (marker[1].startsWith(fence) && !marker[2].trim()) fence = '';
  }
  if (fence) return lines.concat(fence).join('\n');

  const lastIndex = lines.length - 1;
  const last = lines[lastIndex].slice(0, pendingInlineCode(lines[lastIndex]));
  const linkOpening = last.lastIndexOf('](');
  const openBracket = last.lastIndexOf('[');
  if (linkOpening >= 0 && last.indexOf(')', linkOpening + 2) === -1) {
    const start = last.lastIndexOf('[', linkOpening);
    lines[lastIndex] = start >= 0 ? last.slice(0, start) : last;
  } else {
    lines[lastIndex] = openBracket > last.lastIndexOf(']') ? last.slice(0, openBracket) : last;
  }
  return lines.join('\n');
}
