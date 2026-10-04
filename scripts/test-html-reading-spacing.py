"""Compare the same synthetic reading snapshot before/after compact chrome.

Imports only the pure renderer; never loads the desktop app, credentials or APIs.
"""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/html-reading-spacing-20261003'
BASE = os.environ.get('GSM_READING_TEST_URL', 'http://127.0.0.1:4184')
OUT.mkdir(parents=True, exist_ok=True)


def settle(page):
    page.evaluate('async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}')
    page.wait_for_timeout(150)


def metrics(page):
    return page.evaluate('''()=>({
      header:document.querySelector('.app-header').getBoundingClientRect().height,
      bottom:document.querySelector('.bottom-nav').getBoundingClientRect().height,
      firstCardTop:document.querySelector('.project').getBoundingClientRect().top,
      noOverflow:document.documentElement.scrollWidth<=innerWidth,
      summaryFont:getComputedStyle(document.querySelector('.summary')).fontSize,
      viewport:document.querySelector('meta[name=viewport]').content,
    })''')


def detail_metrics(page):
    return page.evaluate('''()=>({
      textTop:document.querySelector('.analysis-summary')?.getBoundingClientRect().top,
      bodyFont:getComputedStyle(document.querySelector('.analysis-summary')).fontSize,
      textHeight:document.querySelector('#detail-scroll').clientHeight,
      bottomHidden:getComputedStyle(document.querySelector('.bottom-nav')).display==='none',
      title:document.querySelector('#detail-title').textContent,
    })''')


def run():
    baseline = (ROOT / 'output/html-reading-redesign-20261003/GSM-新版阅读示例.html').read_text(encoding='utf-8')
    match = re.search(r'<script id="gsm-data" type="application/json">(.*?)</script>', baseline, re.S)
    assert match
    snapshot = json.loads(match[1])
    before_file = OUT / 'GSM-优化前对比.html'
    before_file.write_text(baseline, encoding='utf-8', newline='')
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        context = browser.new_context(viewport={'width':390,'height':844},locale='zh-CN',accept_downloads=True)
        def route(r):
            url = r.request.url
            if url.startswith('file:'):
                r.continue_()
            elif url == BASE+'/fixture':
                r.fulfill(body='<!doctype html><html><body></body></html>',content_type='text/html')
            elif url.startswith(BASE+'/') and '/api/' not in url:
                r.continue_()
            else:
                r.abort()
        context.route('**/*',route)
        renderer = context.new_page(); renderer.goto(BASE+'/fixture')
        html = renderer.evaluate('''async snapshot=>{
          const {renderReadingHtml}=await import('/src/lib/html-reading/render.ts');
          return renderReadingHtml(snapshot);
        }''',snapshot)
        file = OUT / 'GSM-紧凑阅读示例.html'
        file.write_text(html,encoding='utf-8',newline='')
        old = context.new_page(); old.goto(before_file.as_uri()); settle(old)
        old.locator('[data-page="discovery"]').click(); settle(old)
        before = metrics(old); old.screenshot(path=str(OUT/'发现-优化前.png'))
        old.locator('[data-open="1"]').click(); settle(old)
        detail_before = detail_metrics(old); old.screenshot(path=str(OUT/'详情-优化前.png'))
        reader = context.new_page(); reader.on('pageerror',lambda e:errors.append(str(e)))
        reader.goto(file.as_uri()); settle(reader)
        reader.locator('[data-page="discovery"]').click(); settle(reader)
        after = metrics(reader); reader.screenshot(path=str(OUT/'发现-优化后.png'))
        assert after['header'] <= 96 and after['bottom'] <= 50, after
        assert after['header'] < before['header'] and after['bottom'] < before['bottom']
        assert after['firstCardTop'] < before['firstCardTop'] and after['summaryFont']==before['summaryFont']
        assert 'viewport-fit=cover' not in after['viewport']
        # Search expands explicitly; closing preserves the query and matching list.
        reader.locator('#search-toggle').click(); expect(reader.get_by_label('搜索项目')).to_be_visible()
        reader.get_by_label('搜索项目').fill('Ollama')
        matching_count = reader.locator('.project').count(); assert matching_count>0
        reader.locator('#search-toggle').click(); expect(reader.locator('#search-row')).to_be_hidden()
        assert reader.locator('.project').count()==matching_count
        reader.locator('#search-toggle').click(); expect(reader.get_by_label('搜索项目')).to_have_value('Ollama')
        reader.get_by_label('搜索项目').fill(''); reader.locator('#search-toggle').click()
        reader.locator('[data-open="1"]').click(); settle(reader)
        detail_after = detail_metrics(reader); reader.screenshot(path=str(OUT/'详情-优化后.png'))
        assert detail_after['textTop'] < detail_before['textTop']-70,(detail_before,detail_after)
        assert detail_after['bodyFont']==detail_before['bodyFont']=='16px'
        assert detail_after['bottomHidden']
        reader.get_by_role('tab',name='使用',exact=True).click()
        expect(reader.locator('#detail-content')).to_contain_text('docker compose up -d')
        reader.get_by_label('阅读笔记').fill('紧凑版笔记与回传仍然可用')
        reader.locator('#detail-back').click(); expect(reader.locator('#detail-page')).to_be_hidden()
        reader.locator('#info').click(); expect(reader.locator('#section-description')).to_contain_text('更新于')
        reader.locator('#theme').click(); expect(reader.locator('body')).to_have_attribute('data-mode','dark')
        reader.locator('#information [data-close-dialog]').click(); expect(reader.locator('#information')).to_be_hidden()
        layouts=[]
        for width in [360,390,430,768,1024]:
            for theme in ['light','dark']:
                reader.set_viewport_size({'width':width,'height':844})
                reader.evaluate('(mode)=>document.body.dataset.mode=mode',theme)
                for page in ['repositories','discovery']:
                    reader.locator(f'[data-page="{page}"]').click(); settle(reader)
                    reader.evaluate('window.scrollTo(0,0)'); settle(reader)
                    current=metrics(reader)
                    assert current['noOverflow'],(width,theme,page)
                    too_small=reader.locator('button:visible').evaluate_all('els=>els.filter(e=>e.getBoundingClientRect().height<43.5).map(e=>e.id)')
                    assert not too_small,(width,theme,page,too_small)
                    reader.screenshot(path=str(OUT/f'{page}-{width}-{theme}.png'),animations='disabled')
                    layouts.append({'width':width,'theme':theme,'page':page,'noOverflow':True})
        # Font enlargement, landscape and end-of-list remain readable above nav.
        reader.set_viewport_size({'width':360,'height':844}); reader.evaluate("document.body.style.setProperty('--size','20px')")
        reader.locator('[data-page="repositories"]').click(); settle(reader)
        assert metrics(reader)['noOverflow']
        reader.screenshot(path=str(OUT/'字体20px.png'))
        reader.set_viewport_size({'width':844,'height':390}); settle(reader); assert metrics(reader)['noOverflow']
        reader.screenshot(path=str(OUT/'横屏.png'))
        reader.set_viewport_size({'width':390,'height':844})
        reader.evaluate("document.body.style.setProperty('--size','16px')")
        reader.evaluate('window.scrollTo(0,0)'); settle(reader)
        reader.locator('#load-more').click(); reader.locator('#load-more').click()
        reader.mouse.wheel(0,900); settle(reader)
        anchor=reader.locator('.project').evaluate_all('''els=>{const h=document.querySelector('.app-header').getBoundingClientRect().bottom;const e=els.find(e=>e.getBoundingClientRect().top>=h&&e.getBoundingClientRect().top<innerHeight-150);return {id:e.dataset.id,y:e.getBoundingClientRect().top};}''')
        reader.locator(f'[data-open="{anchor["id"]}"]').click(); reader.locator('#detail-back').click()
        expect(reader.locator('#detail-page')).to_be_hidden(); settle(reader)
        position=reader.locator(f'.project[data-id="{anchor["id"]}"]').bounding_box()
        assert abs(position['y']-anchor['y'])<3,(anchor,position)
        reader.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)'); settle(reader)
        end=reader.locator('#list-end').bounding_box(); nav=reader.locator('.bottom-nav').bounding_box()
        assert end and nav and end['y']+end['height']<=nav['y'],(end,nav)
        reader.locator('#export').click()
        payload=json.loads(reader.get_by_label('回传文本').input_value())
        assert payload['version']==2 and any(o['field']=='note' and o['value']=='紧凑版笔记与回传仍然可用' for o in payload['operations'])
        assert not errors,errors
        report={'passed':True,'before':before,'after':after,'detailBefore':detail_before,'detailAfter':detail_after,
          'layouts':layouts,'clickMinHeight':44,'searchDraftPreserved':True,'themeStillAvailable':True,
          'noteReturn':True,'returnAnchorPreserved':True,'lastItemNotCovered':True,'pageErrors':errors,
          'scope':'Same synthetic data, desktop Chrome file://; Android viewer safe insets not verified on device'}
        (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8',newline='')
        print(json.dumps(report,ensure_ascii=True));browser.close()


if __name__=='__main__': run()
