/** Pure display rules shared by the desktop and the standalone reading file. */
export const repositoryListDescriptionClass = 'text-sm leading-6 text-muted-foreground line-clamp-4 break-words transition-colors duration-200 [text-wrap:pretty] hover:text-foreground';
export const repositoryListSurfaceClass = 'repository-card repository-card--list ui-card group relative px-5 py-4 transition-[color,background-color,border-color,box-shadow] duration-200 cursor-pointer';
export const repositoryDetailFields = {
  overview: ['problem', 'features', 'scenarios'],
  usage: ['architecture', 'deployment', 'cost', 'quickstart'],
  maintenance: ['maintenance'],
} as const;
export function repositoryNameParts(fullName: string) {
  const separator = fullName.indexOf('/');
  const owner = separator < 0 ? '' : fullName.slice(0, separator);
  const name = separator < 0 ? fullName : fullName.slice(separator + 1);
  return { owner, name, initials: (owner || name).slice(0, 2).toUpperCase() };
}
export function isRepeatedRepositoryProblem(problem: string | null | undefined, summary: string) {
  const normalized = (problem ?? '').trim().toLocaleLowerCase();
  const text = summary.trim().toLocaleLowerCase();
  return Boolean(normalized && text && (normalized === text || normalized.includes(text) || text.includes(normalized)));
}
