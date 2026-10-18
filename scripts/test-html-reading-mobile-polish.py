"""Actual offline HTML verification; synthetic workspace, no mail/AI/Star requests."""
import importlib.util
import json
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/html-reading-mobile-polish-20261004'
OUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('fixture', ROOT/'scripts/test-html-reading-redesign.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
BASE = fixture.BASE

def settle(page):
    page.wait_for_timeout(220)

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        context = browser.new_context(viewport={'width':1280,'height':900}, locale='zh-CN', accept_downloads=True)
        errors = []
        def route(request):
            u = urlparse(request.request.url)
            if u.netloc == urlparse(BASE).netloc and u.path == '/fixture':
                request.fulfill(body='<!doctype html>', content_type='text/html'); return
            if u.scheme == 'file' or u.netloc == urlparse(BASE).netloc and not u.path.startswith('/api'):
                request.continue_(); return
            request.abort()
        context.route('**/*', route)
        desktop = context.new_page()
        repos = [fixture.repository(i) for i in range(1,9)]
        repos[4]['name'] = 'a-very-long-repository-name-for-mobile-title-validation'
        repos[4]['full_name'] = 'fixture/' + repos[4]['name']
        fixture.install_fixture(desktop, repos[:4])
        desktop.evaluate("""async repos=>{const{useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState({discoveryRepos:{trending:repos}})}""", repos)
        editions = []
        for day, complete, selected in [('2026-10-04',True,repos[3:]),('2026-10-03',False,repos[5:]),('2026-10-02',False,[])]:
            editions.append({'channelId':'custom:reading','date':day,'revision':1,'instruction':'演示阅读布局','complete':complete,
                'generatedAt':day+'T00:00:00Z','entries':[{'repo':repo,'reason':'模拟发现推荐理由','verdict':'match','evidence':[],
                'method':'rules','relevance':1,'preference':1} for repo in selected], 'pending':[],'errors':[],'searched':len(selected),'filtered':0})
        desktop.evaluate("""async editions=>{const{transact}=await import('/src/features/discovery/custom/storage.ts');await transact('42',data=>{data.channels=[{id:'custom:reading',name:'演示频道'}];data.editions=editions})}""", editions)
        generated = fixture.generate(desktop, {'maxFileMb':15})
        assert generated['snapshot']['items']['4']['starStatus'] == 'starred'
        assert generated['snapshot']['items']['5']['starStatus'] == 'unknown'
        sample = OUT / 'GSM-手机阅读优化示例.html'
        sample.write_text(generated['html'], encoding='utf-8')
        # Compare the previous checked-in reader against the identical snapshot.
        # The comparison is synthetic; never loads the real desktop profile.
        for filename in ['render.ts','reader-style.txt','reader-runtime.txt']:
            source=subprocess.check_output(['git','show','HEAD:src/lib/html-reading/'+filename],cwd=ROOT).decode('utf-8')
            if filename=='render.ts':
                source=source.replace("from './model'", "from '/src/lib/html-reading/model'").replace("from './icons'", "from '/src/lib/html-reading/icons'").replace("from '../repositoryReadingPresentation'", "from '/src/lib/repositoryReadingPresentation'")
            (OUT/filename).write_text(source,encoding='utf-8')
        before_html=desktop.evaluate("""async snapshot=>{const{renderReadingHtml}=await import('/output/html-reading-mobile-polish-20261004/render.ts');return renderReadingHtml(snapshot)}""",generated['snapshot'])
        before_file=OUT/'GSM-优化前同数据.html';before_file.write_text(before_html,encoding='utf-8')
        baseline_context=browser.new_context(viewport={'width':390,'height':844},locale='zh-CN')
        before=baseline_context.new_page();before.goto(before_file.as_uri());settle(before)
        before.screenshot(path=str(OUT/'仓库-优化前同数据.png'))
        before.locator('[data-page="discovery"]').click();before.locator('#channel-tabs button',has_text='演示频道').click();settle(before)
        baseline_size=before.evaluate("""()=>({header:document.querySelector('.app-header').getBoundingClientRect().height,firstCard:document.querySelector('.project').getBoundingClientRect().top})""")
        before.screenshot(path=str(OUT/'发现-优化前同数据.png'))
        before.locator('[data-open="5"]').click();before.locator('.reading-controls').scroll_into_view_if_needed();settle(before)
        before.screenshot(path=str(OUT/'详情-优化前同数据.png'));baseline_context.close()
        reader = context.new_page(); reader.on('pageerror', lambda error:errors.append(str(error)))
        reader.goto(sample.as_uri()); settle(reader)
        layouts = []
        for width in [360,390,430,768,1024]:
            reader.set_viewport_size({'width':width,'height':844})
            for mode in ['light','dark']:
                reader.evaluate('(mode)=>document.body.dataset.mode=mode',mode)
                settle(reader)
                size = reader.evaluate("""()=>({width:innerWidth,overflow:document.documentElement.scrollWidth,
                    header:document.querySelector('.app-header').getBoundingClientRect().height,
                    firstCard:document.querySelector('.project').getBoundingClientRect().top})""")
                assert size['overflow'] <= width+1, size
                assert size['header'] <= 96, size
                layouts.append({**size,'mode':mode})
                if width == 390: reader.screenshot(path=str(OUT/f'仓库-{mode}.png'))
        reader.set_viewport_size({'width':390,'height':844})
        reader.evaluate("document.body.dataset.mode='light'")
        reader.locator('[data-page="discovery"]').click(); settle(reader)
        reader.locator('#channels-open').click()
        reader.locator('#drawer-content button',has_text='演示频道').click(); settle(reader)
        expect(reader.locator('.project')).to_have_count(5)
        expect(reader.locator('.star-badge')).to_have_count(1)
        reader.screenshot(path=str(OUT/'发现-紧凑顶部.png'))
        after_size=reader.evaluate("""()=>({header:document.querySelector('.app-header').getBoundingClientRect().height,firstCard:document.querySelector('.project').getBoundingClientRect().top})""")
        assert after_size['firstCard']<baseline_size['firstCard'],(baseline_size,after_size)
        reader.locator('#edition-open').click()
        expect(reader.locator('#edition-panel')).to_be_visible()
        expect(reader.locator('[data-edition]')).to_have_count(2)
        expect(reader.locator('#edition-list')).not_to_contain_text('2026-10-02')
        for width in [360,390,430,768,1024]:
            reader.set_viewport_size({'width':width,'height':844})
            for mode in ['light','dark']:
                reader.evaluate('(mode)=>document.body.dataset.mode=mode',mode)
                settle(reader)
                assert reader.locator('#edition-panel').evaluate('(e)=>e.getBoundingClientRect().width<=innerWidth')
                assert reader.locator('.edition-option').evaluate_all('(elements)=>elements.every(e=>e.scrollWidth<=e.clientWidth+1)')
        reader.set_viewport_size({'width':390,'height':844});reader.evaluate("document.body.dataset.mode='light'")
        reader.screenshot(path=str(OUT/'期刊-底部面板.png'))
        reader.go_back(); settle(reader)
        expect(reader.locator('#edition-panel')).to_be_hidden()
        reader.locator('#info').click(); expect(reader.locator('#empty-editions')).to_contain_text('2026-10-02')
        reader.go_back(); settle(reader)
        reader.locator('[data-open="5"]').click(); settle(reader)
        expect(reader.locator('#detail-title')).to_have_text(repos[4]['name'])
        reader.locator('#detail-options-open').click()
        reader.locator('.project-information summary').click()
        expect(reader.locator('#detail-full-name')).to_have_text(repos[4]['full_name'])
        expect(reader.locator('#detail-star-status')).to_contain_text('状态未知')
        reader.go_back(); settle(reader)
        for width in [360,390,430,768,1024]:
            reader.set_viewport_size({'width':width,'height':844})
            for font in ['16px','20px']:
                reader.evaluate('(font)=>document.body.style.setProperty("--size",font)',font)
                reader.locator('.reading-controls').scroll_into_view_if_needed(); settle(reader)
                controls = reader.locator('.reading-controls > *').evaluate_all("""els=>els.map(e=>({y:e.getBoundingClientRect().y,height:e.getBoundingClientRect().height,scroll:e.scrollWidth,width:e.clientWidth}))""")
                assert len(controls)==4 and max(c['y'] for c in controls)-min(c['y'] for c in controls)<1, controls
                assert all(c['height']>=44 and c['scroll']<=c['width']+1 for c in controls), controls
        reader.set_viewport_size({'width':390,'height':844});reader.evaluate("document.body.style.setProperty('--size','16px')")
        reader.locator('.note-editor').scroll_into_view_if_needed();settle(reader)
        assert not reader.locator('.note-editor').evaluate('(element)=>element.open')
        reader.screenshot(path=str(OUT/'详情-单行操作与按需笔记.png'))
        reader.locator('[data-field="candidate"]').click()
        reader.locator('.note-editor summary').click()
        reader.locator('textarea[data-field="note"]').fill('手机笔记：回桌面进一步了解项目。')
        reader.locator('textarea[data-field="note"]').blur(); reader.locator('.note-editor summary').click();settle(reader)
        expect(reader.locator('.note-preview')).to_contain_text('手机笔记')
        reader.go_back();settle(reader)
        reader.locator('#export').click()
        payload=json.loads(reader.locator('#return-text').input_value())
        assert any(op['field']=='note' and op['repoId']==5 for op in payload['operations'])
        assert any(op['field']=='candidate' and op['repoId']==5 for op in payload['operations'])
        assert payload['version']==2
        reader.go_back();settle(reader);reader.reload();settle(reader)
        reader.locator('[data-open="5"]').click()
        expect(reader.locator('.note-preview')).to_contain_text('手机笔记')
        reader.go_back();settle(reader);reader.locator('[data-open="4"]').click()
        expect(reader.locator('.reading-controls .star-readonly')).to_contain_text('已 Star')
        expect(reader.locator('.reading-controls [data-field="candidate"]')).to_have_count(0)
        assert not errors, errors
        (OUT/'report.json').write_text(json.dumps({'passed':True,'layouts':layouts,'comparison':{'before':baseline_size,'after':after_size},'pageErrors':errors,
            'sameRowControls':True,'notePersistenceAndReturn':True,'starStateAndReadonlyCandidate':True,
            'emptyEditionReasonPreserved':True,'browserBack':True,'noMailAIOrStar':True,'androidVerified':False},ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()

if __name__=='__main__': run()
