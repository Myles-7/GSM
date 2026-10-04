"""Isolated real generator + desktop settings + file reader. No mail/model/Star."""
import importlib.util
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/html-reading-customization-20261003'
OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-html-reading-redesign.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
BASE=fixture.BASE

def settle(page):
    page.evaluate('async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}')
    page.wait_for_timeout(100)

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
        repos=[fixture.repository(i) for i in range(1,91)]
        repos[0]['ai_summary']=repos[0]['ai_details']['summary']='这个测试项目用于完整摘要阅读。它展示资料收集、搜索、笔记整理与离线导出等能力，帮助读者了解项目用途。'*15
        state=fixture.install_fixture(desktop,repos)
        editions=[]
        for age in range(4):
            date=(datetime.now(timezone.utc)-timedelta(days=age)).date().isoformat()
            editions.append({'channelId':'custom:reading','date':date,'revision':1,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'complete':True,'instruction':'synthetic','entries':[{'repo':r,'reason':'测试推荐理由：适合离线资料整理。'} for r in repos[:8]]})
        desktop.evaluate("""async editions=>{const {transact}=await import('/src/features/discovery/custom/storage.ts');await transact('42',d=>{d.channels=[{id:'custom:reading',name:'自部署工具'}];d.editions=editions;});}""",editions)
        options={'maxFileMb':15,'autoRead':False,'repositoryProfile':{'cardFields':['summary','category','tags','language','stars'],'detailModes':{'architecture':'omit'}},'channelProfiles':{'trending':{'perChannel':6,'detailModes':{'features':'collapsed'}},'custom:reading':{'perChannel':3,'historyCount':2}}}
        output=fixture.generate(desktop,options)
        assert output['snapshot']['items']['1']['summary']==repos[0]['ai_summary']
        assert len(output['snapshot']['sections'][1]['entries'])==6
        assert len(output['snapshot']['sections'][2]['editions'])==2
        assert all(len(e['entries'])==3 for e in output['snapshot']['sections'][2]['editions'])
        sample=OUT/'GSM-完整摘要与自定义阅读示例.html';sample.write_text(output['html'],encoding='utf-8')
        reader=context.new_page();reader.on('pageerror',lambda e:errors.append(str(e)));reader.set_viewport_size({'width':390,'height':844});reader.goto(sample.as_uri());settle(reader)
        assert reader.locator('.summary').first.text_content()==repos[0]['ai_summary']
        css=reader.locator('.summary').first.evaluate('e=>({clamp:getComputedStyle(e).webkitLineClamp,font:getComputedStyle(e).fontSize})')
        assert css['clamp']=='none' and css['font']=='16px',css
        reader.screenshot(path=str(OUT/'完整摘要卡片.png'))
        reader.locator('[data-open="1"]').click();settle(reader)
        original=reader.locator('.folded-block').filter(has=reader.locator('summary',has_text='原始介绍'))
        expect(original).not_to_have_attribute('open','')
        reader.screenshot(path=str(OUT/'详情-原始介绍折叠.png'))
        reader.locator('#detail-options-open').click();reader.locator('#next-project').click();settle(reader)
        expect(reader.locator('#detail-title')).to_have_text('fixture/Ollama')
        reader.go_back();settle(reader);expect(reader.locator('#detail-page')).to_be_hidden()
        target=reader.locator('.project[data-id="2"]');assert -2<=target.evaluate('e=>e.getBoundingClientRect().top-document.querySelector(".app-header").getBoundingClientRect().bottom')<=30
        reader.locator('[data-action="interest"][data-repo="2"]').click()
        reader.locator('#reading-view-open').click();reader.locator('#drawer-content button',has_text='感兴趣').click();settle(reader)
        expect(reader.locator('.project')).to_have_count(1);reader.reload();settle(reader);expect(reader.locator('.project')).to_have_count(1)
        reader.locator('#export').click();payload=json.loads(reader.locator('#return-text').input_value());assert all(op['field']!='read' for op in payload['operations']);reader.locator('#close-export').click();settle(reader)
        imported=desktop.evaluate("""async payload=>{const {applyReadingReturn}=await import('/src/lib/html-reading/storage.ts');return applyReadingReturn('42',payload,{});}""",payload)
        assert imported['applied']==1
        reader.locator('[data-page="discovery"]').click();settle(reader);reader.locator('[data-open="1"]').click();settle(reader)
        expect(reader.locator('.folded-block summary',has_text='主要功能')).to_be_visible()
        expect(reader.locator('#detail-content')).to_contain_text('其他入选频道')
        reader.screenshot(path=str(OUT/'频道详情-独立栏目.png'))
        reader.go_back();settle(reader)
        # 20 layouts with fresh storage to avoid filtered/no-content fixture.
        reader.add_init_script("localStorage.clear()")
        layouts=[]
        for width in [360,390,430,768,1024]:
            for mode in ['light','dark']:
                for page in ['repositories','discovery']:
                    reader.evaluate('localStorage.clear()');reader.reload();reader.set_viewport_size({'width':width,'height':844});reader.locator(f'[data-page="{page}"]').click();reader.evaluate('(mode)=>document.body.dataset.mode=mode',mode);settle(reader)
                    m=reader.evaluate('()=>({overflow:document.documentElement.scrollWidth>innerWidth,header:document.querySelector(".app-header").getBoundingClientRect().height,bottom:document.querySelector(".bottom-nav").getBoundingClientRect().height,minimum:Math.min(...[...document.querySelectorAll("button")].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>e.getBoundingClientRect().height))})')
                    assert not m['overflow'] and m['minimum']>=43.9,m
                    reader.screenshot(path=str(OUT/f'{page}-{width}-{mode}.png'));layouts.append({'width':width,'theme':mode,'page':page,**m})
        # Actual settings page, overrides survive saving and preview uses actual generation.
        desktop.evaluate("""async options=>{const{readingTransaction}=await import('/src/lib/html-reading/storage.ts');const{saveReadingDiscoveryCache}=await import('/src/lib/html-reading/cache.ts');const{discoverySourceSignature}=await import('/src/features/discovery/workspace/source.ts');const{useAppStore}=await import('/src/store/useAppStore.ts');const state=useAppStore.getState();await readingTransaction('42',data=>{data.settings={...data.settings,...options,channelIds:['trending','custom:reading']};});await saveReadingDiscoveryCache('42','trending',discoverySourceSignature(state,'trending',false),{repos:state.discoveryRepos.trending,updatedAt:new Date().toISOString(),status:'updated',fetchedTarget:12,exhausted:true});}""",options)
        desktop.evaluate("sessionStorage.setItem('gsm:pending-settings-tab','htmlReading')")
        desktop.get_by_role('button',name='设置',exact=True).click();settle(desktop)
        desktop.get_by_role('tab',name='内容范围',exact=True).click()
        expect(desktop.get_by_label('阅读预设')).to_be_visible()
        desktop.get_by_role('tab',name='频道配置',exact=True).click()
        desktop.get_by_text('发现默认内容与频道高级调整',exact=True).click()
        desktop.locator('summary',has_text='趋势 ·').click()
        desktop.get_by_role('heading',name='趋势',exact=True).locator('..').locator('..').get_by_label('每频道／每期项目上限').fill('7')
        desktop.get_by_role('button',name='保存设置',exact=True).click();expect(desktop.get_by_text('设置已保存；定时邮件将使用已保存配置。',exact=True)).to_be_visible()
        desktop.screenshot(path=str(OUT/'桌面-频道高级设置.png'))
        desktop.get_by_role('button',name='预览 HTML',exact=True).click();expect(desktop.get_by_role('button',name='打开独立浏览器预览')).to_be_visible()
        desktop.screenshot(path=str(OUT/'桌面-实际文件统计预览.png'))
        with context.expect_page() as popup_event:desktop.get_by_role('button',name='打开独立浏览器预览').click()
        popup=popup_event.value;popup.wait_for_load_state();preview_frame=popup.frame_locator('iframe')
        expect(preview_frame.locator('.project')).not_to_have_count(0)
        preview_frame.locator('[data-open="1"]').click();expect(preview_frame.locator('#detail-page')).to_be_visible()
        preview_frame.locator('#detail-back').click();expect(preview_frame.locator('#detail-page')).to_be_hidden()
        popup.get_by_role('button',name='预览深色',exact=True).click();expect(preview_frame.locator('body')).to_have_attribute('data-mode','dark')
        popup.get_by_role('button',name='430px',exact=True).click();expect(popup.locator('iframe')).to_have_css('width','430px')
        popup.screenshot(path=str(OUT/'独立浏览器-实际文件预览.png'));popup.close()
        # Variable-height long summaries, 5,000 real items, max 120 mounted cards.
        large_repos=[fixture.repository(i+10001) for i in range(5000)]
        for i,r in enumerate(large_repos):
            if i%37==0:r['ai_summary']=r['ai_details']['summary']=r['ai_summary']*5
        desktop.evaluate("""async repos=>{const {useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState({repositories:repos});}""",large_repos)
        large=fixture.generate(desktop,{'discovery':False,'maxFileMb':15,'autoRead':False})
        large_file=OUT/'GSM-5000仓库完整摘要测试.html';large_file.write_text(large['html'],encoding='utf-8')
        reader.evaluate('localStorage.clear()');reader.goto(large_file.as_uri());settle(reader);expect(reader.locator('.project')).to_have_count(40)
        for i in range(7):reader.locator('#load-more').click();settle(reader)
        assert reader.locator('.project').count()<=120
        first_id=reader.locator('.project').first.get_attribute('data-id');anchor=reader.locator(f'.project[data-id="{first_id}"]');anchor.scroll_into_view_if_needed();settle(reader)
        top=anchor.evaluate('e=>e.getBoundingClientRect().top');anchor.locator('.card-main').click();reader.go_back();settle(reader);delta=abs(reader.locator(f'.project[data-id="{first_id}"]').evaluate('e=>e.getBoundingClientRect().top')-top);assert delta<3,delta
        reader.locator('#search-toggle').click();reader.locator('#search').fill(large_repos[4999]['full_name']);settle(reader);expect(reader.locator('.project')).to_have_count(1)
        assert not errors,errors
        (OUT/'report.json').write_text(json.dumps({'passed':True,'pageErrors':errors,'layouts':layouts,'fullSummaryCharacters':len(repos[0]['ai_summary']),'manualRead':True,'adjacentBackAnchor':True,'readingViewReload':True,'imported':imported,'largeItemCount':5000,'largeBytes':large['bytes'],'maxLiveCards':120,'detailReturnPixelDelta':delta,'noMailModelOrStar':True,'androidGmailVerified':False},ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()

if __name__=='__main__':run()
