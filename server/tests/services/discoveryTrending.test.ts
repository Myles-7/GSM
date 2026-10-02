import {describe,it,expect,vi} from 'vitest';
import {readTrending,trendingRepositoryNames} from '../../src/services/discoveryTrending.js';
const html='<title>Trending repositories on GitHub</title><a href="/noise/link">noise</a><article class="Box-row"><a href="/sponsor/link">sponsor</a><h2 class="h3"><a href="/owner/tool">owner / tool</a></h2></article>';
describe('official trending with RSS fallback',()=>{
 it('reads ranking headings in order without navigation or sponsors',()=>{expect(trendingRepositoryNames(html+html)).toEqual(['owner/tool']);});
 it('prefers official GitHub with requested language and time range',async()=>{const read=vi.fn(async()=>html);expect(await readTrending(read,'weekly','C++')).toEqual({names:['owner/tool'],source:'github-trending'});expect(read).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledWith('https://github.com/trending/c%2B%2B?since=weekly');});
 it('falls back after network failure or non-ranking upstream content',async()=>{for(const bad of [new Error('timeout'),'<html>login challenge</html>']){const read=vi.fn().mockImplementationOnce(async()=>{if(bad instanceof Error)throw bad;return bad;}).mockResolvedValueOnce('<rss><link><![CDATA[https://github.com/fallback/repo]]></link></rss>');expect(await readTrending(read,'monthly','')).toEqual({names:['fallback/repo'],source:'github-trending-rss'});expect(read).toHaveBeenCalledTimes(2);}});
 it('allows a valid empty ranking but rejects invalid fallback',async()=>{expect(trendingRepositoryNames('<h1>Trending</h1>')).toEqual([]);await expect(readTrending(vi.fn(async()=>'<html>error</html>'),'daily','')).rejects.toThrow('DISCOVERY_INVALID_RESPONSE');});
});
