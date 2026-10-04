export function organizationInstruction(previous: string | undefined, next: string, retryOnly = false): string {
  const before = previous?.trim() ?? '';
  const current = next.trim();
  const result = retryOnly || !current || before === current ? before || current : [before, current].filter(Boolean).join('\n');
  if (result.length > 10000) throw new Error('Organization requirements exceed the limit; start a new draft with a concise combined requirement.');
  return result;
}
