"""Real DailyReadingView and persistence in an isolated Chromium profile; no external writes."""
import importlib.util
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/daily-reading-ux-20261006'
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('GSM_READING_TEST_URL', 'http://127.0.0.1:4196')
spec = importlib.util.spec_from_file_location('fixture', ROOT/'scripts/test-html-reading-redesign.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.BASE = BASE


def mount(page, daily=True):
    page.evaluate('''async daily=>{
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const {ensureLanguageLoaded}=await import('/src/i18n/index.ts');await ensureLanguageLoaded('zh');
      const {useHtmlReading}=await import('/src/features/settings/hooks/useHtmlReading.ts');
      const {HtmlReadingImport}=await import('/src/components/settings/HtmlReadingImport.tsx');
      const {DailyReadingView}=await import('/src/components/reading/DailyReadingView.tsx');
      function Legacy(){const c=useHtmlReading();window.fixtureC=c;return React.createElement(HtmlReadingImport,{controller:c});}
      window.fixtureRoot?.unmount();document.body.innerHTML='<main id="fixture-root" class="mx-auto max-w-[1440px] p-6"></main>';
      window.fixtureRoot=createRoot(document.getElementById('fixture-root'));
      window.fixtureRoot.render(React.createElement(daily?DailyReadingView:Legacy));
    }''', daily)


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        context = browser.new_context(viewport={'width':1440,'height':1000}, locale='zh-CN')
        requests, errors = [], []
        def route(r):
            u=urlparse(r.request.url)
            if u.netloc==urlparse(BASE).netloc and u.path=='/fixture':
                r.fulfill(body='<!doctype html><link rel="stylesheet" href="/src/index.css"><div id="root"></div>',content_type='text/html');return
            if u.netloc==urlparse(BASE).netloc and not u.path.startswith('/api'):
                r.continue_();return
            requests.append({'method':r.request.method,'url':r.request.url})
            r.fulfill(status=503,json={'error':'isolated test: external network disabled'})
        context.route('**/*', route)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(e.stack or str(e)))
        repos=[fixture.repository(i) for i in range(1,5001)]
        print('install fixture',flush=True)
        # Seed the store without mounting App: its background services are outside this UI test.
        state={'githubToken':'isolated-test-token','isAuthenticated':True,'user':{'id':42,'login':'fixture'},
               'repositories':repos[:600],'language':'zh','theme':'light','themePreset':'default',
               'customCategories':[],'hiddenDefaultCategoryIds':[],'defaultCategoryOverrides':{},
               'discoveryRepos':{'trending':repos[600:]},'discoveryLastRefresh':{},'aiConfigs':[]}
        page.goto(BASE+'/fixture')
        page.evaluate('''async state=>{
          const {useAppStore}=await import('/src/store/useAppStore.ts');
          await useAppStore.persist.rehydrate();useAppStore.setState(state);
        }''',state)
        print('seed reading records',flush=True)
        page.evaluate('''async repos=>{
          const {candidateTransaction}=await import('/src/lib/html-reading/candidates.ts');
          const {useAppStore}=await import('/src/store/useAppStore.ts');
          useAppStore.setState({repositories:repos.slice(0,600),discoveryRepos:{trending:repos.slice(600)}});
          await candidateTransaction('42',data=>{
            for(const repo of repos){const id=String(repo.id);data.names[id]=repo.full_name;
              data.states[id]={candidate:true,read:repo.id%2===0,interest:repo.id%3===0?'interested':'neutral',note:repo.id%4===0?'隔离测试笔记：保留资料，不发送真实请求。':''};}
          });
        }''',repos)
        print('mount previous view',flush=True)
        mount(page,False)
        page.wait_for_function('window.fixtureC?.candidates.items.length===5000',timeout=120000)
        page.get_by_role('tab',name=re.compile('^Star 候选')).click()
        expect(page.get_by_role('tabpanel',name=re.compile('^Star 候选')).locator('article')).to_have_count(40)
        page.screenshot(path=str(OUT/'项目处理-改造前.png'))
        print('mount daily reading',flush=True)
        start=time.perf_counter();mount(page)
        # The actual projects region has a stable list accessible name.
        listing=page.get_by_label('阅读项目列表',exact=True)
        try:
            expect(listing.locator('article')).to_have_count(40,timeout=60000)
        except Exception:
            page.screenshot(path=str(OUT/'debug-daily.png'))
            print(json.dumps({'errors':errors,'body':page.locator('body').inner_text(),'lists':page.locator('[aria-label=\"阅读项目列表\"]').count()},ensure_ascii=False),flush=True)
            raise
        first_ms=round((time.perf_counter()-start)*1000)
        page.screenshot(path=str(OUT/'统一项目处理-双栏.png'))
        listing.evaluate("e=>{e.scrollTop=220;e.dispatchEvent(new Event('scroll',{bubbles:true}));}")
        scroll_before=listing.evaluate('e=>e.scrollTop')
        mount(page)
        expect(listing.locator('article')).to_have_count(40)
        page.wait_for_function("Math.abs(document.querySelector('[aria-label=\"阅读项目列表\"]').scrollTop-220)<3")
        assert abs(listing.evaluate('e=>e.scrollTop')-scroll_before)<3
        page.get_by_role('button',name=re.compile('^选择全部 5000')).click()
        expect(page.get_by_text('跨页已选 5000 个',exact=True)).to_be_visible()
        page.get_by_role('button',name='下一页',exact=True).last.click()
        expect(page.get_by_text('跨页已选 5000 个',exact=True)).to_be_visible()
        page.get_by_role('button',name='Star 已选项目',exact=True).click()
        dialog=page.get_by_role('dialog');expect(dialog).to_be_visible()
        expect(dialog.locator('li')).to_have_count(40)
        page.screenshot(path=str(OUT/'批量Star-一次确认.png'))
        dialog.get_by_role('button',name='取消',exact=True).first.click()
        page.get_by_role('button',name='清除选择',exact=True).click()
        search=page.get_by_label('搜索项目名称与已保存笔记')
        search.fill(repos[-1]['full_name']);expect(listing.locator('article')).to_have_count(1)
        listing.get_by_role('checkbox').check()
        page.get_by_label('更新已选项目',exact=True).select_option('process')
        expect(listing.locator('article')).to_have_count(0)
        page.get_by_role('button',name=re.compile('^已处理')).click()
        expect(listing.locator('article')).to_have_count(1)
        listing.get_by_role('checkbox').check()
        page.get_by_label('更新已选项目',exact=True).select_option('restore')
        expect(listing.locator('article')).to_have_count(0)
        page.get_by_role('button',name=re.compile('^全部待处理')).click()
        expect(listing.locator('article')).to_have_count(1)
        note=page.get_by_role('textbox',name='编辑项目笔记',exact=True)
        note.fill('新的未保存笔记草稿')
        search.fill(repos[-2]['full_name']);expect(listing.locator('article')).to_have_count(1)
        search.fill(repos[-1]['full_name']);expect(note).to_have_value('新的未保存笔记草稿')
        page.get_by_role('button',name='保存笔记',exact=True).click()
        expect(page.get_by_text('笔记已保存',exact=True)).to_be_visible()
        page.screenshot(path=str(OUT/'详情与笔记-连续浏览.png'))
        note.fill('桌面保留的未保存草稿')
        page.get_by_role('button',name='阅读设置',exact=True).click()
        expect(page.get_by_role('button',name='高级设置',exact=True)).to_be_visible()
        expect(page.get_by_role('combobox',name='阅读预设',exact=True)).to_be_visible()
        page.screenshot(path=str(OUT/'常用设置.png'))
        page.get_by_role('button',name='导入手机记录',exact=True).click()
        page.get_by_role('button',name='粘贴记录',exact=True).click()
        payload=page.evaluate('''async()=>{
          const {rememberSnapshot}=await import('/src/lib/html-reading/storage.ts');
          const {defaultSettings}=await import('/src/lib/html-reading/model.ts');
          const {readReadingWorkspace}=await import('/src/lib/html-reading/workspace.ts');
          const data=await readReadingWorkspace('42'),state=data.states['5000'];
          const s={version:1,id:'isolated-daily-reading',accountId:'42',generatedAt:new Date().toISOString(),title:'隔离测试',settings:defaultSettings,sections:[{id:'repositories',title:'仓库',items:[{id:5000,name:data.names['5000'],state}]}]};
          await rememberSnapshot('42',s);
          return{format:'gsm-reading-changes',version:1,accountId:'42',snapshotId:s.id,operations:[{id:crypto.randomUUID(),repoId:5000,field:'note',base:state.note,value:'手机带回的新笔记'}]};
        }''')
        page.get_by_role('textbox',name='手机回传文本',exact=True).fill(json.dumps(payload,ensure_ascii=False))
        page.get_by_role('button',name='预览回传修改',exact=True).click()
        expect(page.get_by_role('button',name='确认导入',exact=True)).to_be_enabled()
        page.screenshot(path=str(OUT/'导入-摘要预览.png'))
        page.get_by_role('button',name='确认导入',exact=True).click()
        page.get_by_role('button',name='浏览并处理本次项目',exact=True).click()
        expect(listing.locator('article')).to_have_count(1)
        expect(page.get_by_role('button',name=re.compile('^本次导入'))).to_have_attribute('aria-pressed','true')
        expect(note).to_have_value('桌面保留的未保存草稿')
        expect(page.get_by_role('button',name='保存笔记',exact=True)).to_be_disabled()
        expect(page.get_by_text('当前已保存笔记: 手机带回的新笔记',exact=True)).to_be_visible()
        page.screenshot(path=str(OUT/'笔记新变化-保留草稿.png'))
        page.get_by_role('button',name='使用当前笔记',exact=True).click()
        expect(note).to_have_value('手机带回的新笔记')
        expect(page.get_by_role('button',name=re.compile('^本次导入'))).to_have_attribute('aria-pressed','true')
        for width in [768,1024,1440]:
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        page.set_viewport_size({'width':1440,'height':1000});page.evaluate("document.documentElement.classList.add('dark')")
        page.screenshot(path=str(OUT/'统一项目处理-深色.png'))
        assert not [r for r in requests if r['method'] in ['PUT','DELETE']],requests
        assert not errors,errors
        report={'passed':True,'syntheticRecords':5000,'maxListRows':40,'maxConfirmationRows':40,'crossPageSelection':True,'cancelNoStar':True,'processRestore':True,'draftAcrossProjects':True,'noteSaved':True,'noteConflictProtected':True,'delayedScrollRestore':True,'guidedImportToProjects':True,'responsiveWidths':[768,1024,1440],'firstScreenMs':first_ms,'pageErrors':errors,'realGitHubStarVerified':False,'realGmailVerified':False,'externalRequestsBlocked':len(requests)}
        (OUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()

if __name__=='__main__':run()
