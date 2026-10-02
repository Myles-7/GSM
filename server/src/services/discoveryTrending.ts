import {SyncError} from './syncV2.js';

/** Only repository headings from the official ranking, never sponsor/navigation links. */
export function trendingRepositoryNames(html:string):string[] {
  const articles=[...html.matchAll(/<article\b[^>]*class=["'][^"']*\bBox-row\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)];
  const names=articles.flatMap(article=>{
    const heading=article[1].match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const name=heading?.match(/href=["']\/([\w.-]+\/[\w.-]+)["']/i)?.[1];
    return name?[name]:[];
  });
  if(!names.length&&!/<(?:h1|title)\b[^>]*>\s*Trending\b/i.test(html))throw new SyncError('DISCOVERY_INVALID_RESPONSE',502);
  return [...new Set(names)];
}

export async function readTrending(fetchText:(url:string)=>Promise<string>,since:string,language:string) {
  try {
    const path=language?`/${encodeURIComponent(language.toLowerCase())}`:'';
    const html=await fetchText(`https://github.com/trending${path}?since=${since}`);
    return {names:trendingRepositoryNames(html),source:'github-trending'};
  } catch {
    const xml=await fetchText(`https://mshibanami.github.io/GitHubTrendingRSS/${since}/all.xml`);
    if(!/<rss\b/i.test(xml))throw new SyncError('DISCOVERY_INVALID_RESPONSE',502);
    return {names:[...new Set([...xml.matchAll(/<link>\s*(?:<!\[CDATA\[)?https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/?(?:\]\]>)?\s*<\/link>/g)].map(m=>m[1]))],source:'github-trending-rss'};
  }
}
