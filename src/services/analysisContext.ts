import type { Gist } from '../types';
export { selectAnalysisContext } from '../../server/src/core/analysisContext';
export function recallGists(gists: Gist[], query: string): Gist[] {
  const terms = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])];
  const score = (gist: Gist) => {
    const title = `${gist.description ?? ''} ${Object.values(gist.files ?? {}).map(file => file.filename).join(' ')}`.toLocaleLowerCase();
    const summary = (gist.ai_summary ?? '').toLocaleLowerCase();
    return terms.reduce((value, term) => value + (title.includes(term) ? 3 : 0) + (summary.includes(term) ? 1 : 0), 0);
  };
  return gists.map((gist, index) => ({ gist, index, score: score(gist) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.gist);
}

