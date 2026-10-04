"""Actual settings export without opening Discovery. Synthetic GitHub, no AI/mail/Star."""
import importlib.util
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/html-reading-discovery-20261004'
OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-html-reading-redesign.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
BASE=fixture.BASE

def run():
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        context=browser.new_context(viewport={'width':1280,'height':900},locale='zh-CN',accept_downloads=True)
        errors=[];console=[];requests=[];failure=[False]
        repos=[fixture.repository(i+100) for i in range(3)]
        def route(r):
            u=urlparse(r.request.url)
            if u.scheme=='file':r.continue_();return
            if u.netloc==urlparse(BASE).netloc and u.path=='/fixture':r.fulfill(body='<!doctype html>');return
            if u.netloc==urlparse(BASE).netloc and not u.path.startswith('/api'):r.continue_();return
            requests.append({'method':r.request.method,'host':u.netloc,'path':u.path})
            if u.netloc=='api.github.com' and u.path=='/search/repositories':
                if failure[0]:r.fulfill(status=403,json={'message':'offline fixture'});return
                args=parse_qs(u.query); assert args.get('per_page')==['3'],args
                r.fulfill(json={'items':repos,'total_count':3,'incomplete_results':False});return
            r.fulfill(status=403,json={'message':'fixture forbids other external calls'})
        context.route('**/*',route)
        desktop=context.new_page();desktop.on('pageerror',lambda e:errors.append(str(e)));desktop.on('console',lambda e:console.append(e.text) if e.type=='error' else None)
        fixture.install_fixture(desktop,[fixture.repository(1)]);desktop.add_style_tag(content='*,*::before,*::after{animation:none!important;transition:none!important}')
        # Blank in-memory channel, selected on HTML settings only. Never navigate Discovery.
        desktop.evaluate("""async()=>{
          const {useAppStore}=await import('/src/store/useAppStore.ts');
          useAppStore.setState({discoveryRepos:{},discoveryLastRefresh:{},currentView:'repositories'});
          const {readingTransaction}=await import('/src/lib/html-reading/storage.ts');
          await readingTransaction('42',d=>{d.settings.channelIds=['most-popular'];d.settings.perChannel=3;d.settings.initialPage='discovery';});
        }""")
        desktop.evaluate("sessionStorage.setItem('gsm:pending-settings-tab','htmlReading')")
        desktop.get_by_role('button',name='设置',exact=True).click()
        expect(desktop.get_by_role('tab',name='概览',exact=True)).to_have_attribute('aria-selected','true')
        with desktop.expect_download() as pending:
            desktop.get_by_role('button',name='导出 HTML',exact=True).click()
        sample=OUT/'GSM-未打开频道直接导出.html';pending.value.save_as(sample)
        expect(desktop.get_by_text('已请求下载 HTML，请确认文件保存成功。',exact=True)).to_be_visible()
        desktop.get_by_text('本次内容检查',exact=False).click()
        expect(desktop.get_by_text('最受欢迎 · 目标 3 · 可用 3 · 导出 3',exact=True)).to_be_visible()
        desktop.screenshot(path=str(OUT/'桌面-未打开频道导出检查.png'))
        count=sum(r['path']=='/search/repositories' for r in requests)
        assert count==1,requests
        state=desktop.evaluate("async()=>{const {useAppStore}=await import('/src/store/useAppStore.ts');return {view:useAppStore.getState().currentView,repos:useAppStore.getState().discoveryRepos};}")
        assert state['repos']=={},state
        reader=context.new_page();reader.on('pageerror',lambda e:errors.append(str(e)));reader.set_viewport_size({'width':390,'height':844});reader.goto(sample.as_uri())
        reader.locator('[data-page="discovery"]').click();expect(reader.locator('.project')).to_have_count(3)
        reader.screenshot(path=str(OUT/'手机-未打开频道已有项目.png'))
        # Fresh preview reuses prepared data rather than issuing another upstream call.
        desktop.get_by_role('button',name='预览 HTML',exact=True).click();expect(desktop.get_by_role('button',name='打开独立浏览器预览')).to_be_visible();desktop.wait_for_timeout(300)
        with context.expect_page() as pending_preview:desktop.get_by_role('button',name='打开独立浏览器预览').click()
        popup=pending_preview.value;popup.wait_for_load_state();iframe=popup.frame_locator('iframe[title="每日 HTML 预览"]');expect(iframe.locator('[data-page="discovery"]')).to_have_attribute('aria-pressed','true');expect(iframe.locator('.project')).to_have_count(3)
        popup.close();desktop.wait_for_timeout(250)
        assert sum(r['path']=='/search/repositories' for r in requests)==count
        # Explicit refresh failing must retain the just prepared source (not an empty desktop UI cache).
        failure[0]=True
        desktop.get_by_role('tab',name='频道配置',exact=True).click();desktop.get_by_role('button',name='更新频道并预览',exact=True).click();expect(desktop.get_by_role('button',name='打开独立浏览器预览')).to_be_visible(timeout=35000);expect(desktop.get_by_role('button',name='更新频道并预览',exact=True)).to_be_enabled(timeout=35000)
        with context.expect_page() as pending_preview:desktop.get_by_role('button',name='打开独立浏览器预览').click()
        popup=pending_preview.value;popup.wait_for_load_state();iframe=popup.frame_locator('iframe[title="每日 HTML 预览"]');expect(iframe.locator('[data-page="discovery"]')).to_have_attribute('aria-pressed','true')
        expect(iframe.locator('.project')).to_have_count(3)
        expect(iframe.locator('#section-warning')).to_contain_text('失败')
        popup.close()
        desktop.screenshot(path=str(OUT/'桌面-刷新失败保留项目.png'))
        assert not errors,errors
        forbidden=[r for r in requests if r['method'] not in ['GET','HEAD'] or any(x in r['path'].lower() for x in ['completions','messages','smtp','starred/'])]
        assert not forbidden,forbidden
        (OUT/'report.json').write_text(json.dumps({'passed':True,'unopenedChannelCount':3,'discoveryStoreUnchanged':True,'previewReusesSources':True,'refreshFailureRetainsContent':True,'iframePointerNavigationVerified':False,'pageErrors':errors,'requests':requests,'noAIStarOrMail':True,'androidGmailVerified':False},ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()

if __name__=='__main__':run()
