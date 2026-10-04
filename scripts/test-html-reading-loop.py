"""Offline actual generated HTML regression. Synthetic data; no mail, AI or Star."""
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/html-reading-loop-20261004'
OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-html-reading-redesign.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
BASE=fixture.BASE
def settle(page):
    page.wait_for_timeout(160)
    page.evaluate('async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}')

def run():
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        context=browser.new_context(viewport={'width':1280,'height':900},locale='zh-CN',accept_downloads=True)
        errors=[];network=[]
        def route(r):
            u=urlparse(r.request.url)
            if u.scheme=='file':r.continue_();return
            if u.netloc==urlparse(BASE).netloc and u.path=='/fixture':r.fulfill(body='<!doctype html>');return
            if u.netloc==urlparse(BASE).netloc and not u.path.startswith('/api'):r.continue_();return
            network.append(u.netloc+u.path);r.fulfill(status=503,json={'error':'fixture blocks external calls'})
        context.route('**/*',route)
        desktop=context.new_page();desktop.on('pageerror',lambda e:errors.append(str(e)))
        repos=[fixture.repository(i) for i in range(1,31)]
        fixture.install_fixture(desktop,repos)
        initial=fixture.generate(desktop,{'discovery':False,'maxFileMb':15})
        new=fixture.repository(31);new['stargazers_count']=999999
        desktop.evaluate("""async repos=>{const{useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState({repositories:repos});}""",[new]+repos)
        output=desktop.evaluate("""async baseline=>{const{defaultSettings}=await import('/src/lib/html-reading/model.ts');const{generateReadingSnapshot}=await import('/src/services/htmlReading.ts');return generateReadingSnapshot({...defaultSettings,discovery:false,maxFileMb:15},[],undefined,{baseline,mode:'export'});}""",initial['snapshot']['comparisonIndex'])
        assert output['snapshot']['items']['31']['dailyChange']=='new'
        assert all('dailyChange' not in output['snapshot']['items'][str(i)] for i in range(1,31))
        desktop.screenshot(path=str(OUT/'桌面-同数据仓库.png'))
        sample=OUT/'GSM-每日阅读闭环示例.html';sample.write_text(output['html'],encoding='utf-8')
        reader=context.new_page();reader.on('pageerror',lambda e:errors.append(str(e)));reader.set_viewport_size({'width':390,'height':844});reader.goto(sample.as_uri());settle(reader)
        expect(reader.locator('.daily-change')).to_have_count(1)
        reader.locator('#reading-view-open').click();reader.locator('#drawer-content button',has_text='本期新增').click();settle(reader)
        expect(reader.locator('.project')).to_have_count(1)
        reader.reload();settle(reader);expect(reader.locator('.project')).to_have_count(1)
        reader.locator('[data-open="31"]').click();reader.locator('#detail-options-open').click();expect(reader.locator('#detail-outline button')).not_to_have_count(0)
        reader.locator('#detail-outline button',has_text='主要功能').click();settle(reader)
        expect(reader.locator('#detail-options')).not_to_be_visible();expect(reader.locator('#detail-page')).to_be_visible()
        note=reader.locator('textarea[data-field="note"]');note.fill('离线阅读测试笔记：值得在桌面进一步研究。');note.blur();settle(reader)
        expect(reader.locator('#note-save-status')).to_contain_text('已保存')
        reader.go_back();settle(reader);expect(reader.locator('#detail-page')).to_be_hidden()
        reader.locator('#export').click();payload=json.loads(reader.locator('#return-text').input_value());assert any(op['field']=='note' for op in payload['operations']);expect(reader.locator('#export-history')).to_contain_text('尚未')
        with reader.expect_download() as event:reader.locator('#download').click()
        event.value.save_as(str(OUT/'GSM-阅读回传.json'));expect(reader.locator('#export-history')).to_contain_text('上次请求下载')
        reader.locator('#close-export').click();settle(reader);reader.locator('[data-open="31"]').click();reader.locator('[data-field="candidate"]').click();reader.go_back();settle(reader)
        reader.locator('#export').click();expect(reader.locator('#export-history')).to_contain_text('之后还有新的修改');assert '不代表电脑已导入' in reader.locator('#export-history').inner_text()
        reader.locator('#close-export').click();settle(reader);reader.reload();settle(reader)
        reader.locator('#reading-view-open').click();reader.locator('#drawer-content').get_by_role('button',name='全部',exact=True).click();settle(reader)
        layouts=[]
        for width in [360,390,430,768,1024]:
            reader.set_viewport_size({'width':width,'height':844});settle(reader)
            for mode in ['light','dark']:
                reader.evaluate('(mode)=>document.body.dataset.mode=mode',mode)
                measurements=reader.evaluate("""()=>({width:innerWidth,document:document.documentElement.scrollWidth,header:document.querySelector('.app-header').getBoundingClientRect().height,nav:document.querySelector('.bottom-nav').getBoundingClientRect().height,padding:parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom),cards:document.querySelectorAll('.project').length})""")
                assert measurements['document']<=width+1,measurements
                assert measurements['padding']<=measurements['nav']+10,measurements
                layouts.append({**measurements,'mode':mode})
                if width in [390,768]:reader.screenshot(path=str(OUT/f'仓库-{width}-{mode}.png'))
        reader.set_viewport_size({'width':390,'height':844});reader.locator('[data-open="31"]').click();settle(reader);reader.screenshot(path=str(OUT/'详情与阅读操作.png'))
        reader.evaluate("document.body.style.setProperty('--size','20px')");settle(reader)
        assert reader.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        reader.locator('#detail-back').click();settle(reader)
        large=[fixture.repository(i+10001) for i in range(5000)]
        desktop.evaluate("""async repos=>{const{useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState({repositories:repos});}""",large)
        generated=fixture.generate(desktop,{'discovery':False,'maxFileMb':15,'autoRead':False})
        large_file=OUT/'GSM-5000仓库性能验证.html';large_file.write_text(generated['html'],encoding='utf-8')
        reader.goto(large_file.as_uri());settle(reader)
        for _ in range(5):reader.locator('#load-more').click();settle(reader)
        assert reader.locator('.project').count()<=120
        reader.locator('#search-toggle').click();reader.locator('#search').fill(large[-1]['full_name']);settle(reader);expect(reader.locator('.project')).to_have_count(1)
        assert not errors,errors
        (OUT/'report.json').write_text(json.dumps({'passed':True,'layouts':layouts,'pageErrors':errors,'newViewReload':True,'outlineJump':True,'noteSaved':True,'exportStatusPreservesRecords':True,'largeItemCount':5000,'maxLiveCards':120,'noMailAIOrStar':True,'androidGmailVerified':False},ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()
if __name__=='__main__':run()
