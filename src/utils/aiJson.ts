/** Extract one complete JSON value without repairing or inventing model output. */
export function parseAIJson(text: string): unknown {
  const cleaned = text.replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* An explanatory prefix may surround a complete object. */ }
  const start = cleaned.indexOf('{');
  if (start < 0) throw new SyntaxError('AI_OUTPUT_INCOMPLETE_JSON');
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < cleaned.length; index++) {
    const char = cleaned[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) {
      const tail = cleaned.slice(index + 1).trim();
      if (tail.includes('{') || tail.includes('}')) throw new SyntaxError('AI_OUTPUT_AMBIGUOUS_JSON');
      return JSON.parse(cleaned.slice(start, index + 1));
    }
  }
  throw new SyntaxError('AI_OUTPUT_INCOMPLETE_JSON');
}
