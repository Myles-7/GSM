"""Actual Header/providers/outer layout; isolated reading data, all external calls blocked."""
import importlib.util
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/daily-reading-clean-20261006'
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('GSM_READING_TEST_URL', 'http://127.0.0.1:4197')
spec=importlib.util.spec_from_file_location('fixture', ROOT/'scripts/test-html-reading-redesign.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture);fixture.BASE=BASE

def reference():
    source=OUT/'source-before/src/components/reading'
    target=OUT/'reference';target.mkdir(exist_ok=True)
    for path in source.iterdir():
        if path.suffix not in ['.ts','.tsx','.css'] or '.test.' in path.name: continue
        text=path.read_text(encoding='utf-8')
        # Keep old presentation modules together; share current services/data fixture.
        def rewrite(match):
            relative=match[2]
            if relative.startswith('../'):
                original=(ROOT/'src/components/reading'/relative).resolve()
                return match[1]+'/'+original.relative_to(ROOT).as_posix()+match[3]
            return match[0]
        text=re.sub(r"(from\s*['\"])(\.[^'\"]+)(['\"])",rewrite,text)
        (target/path.name).write_text(text,encoding='utf-8')

def mount(page, before=False):
    page.evaluate('''async before=>{
      const RefreshRuntime=(await import('/@react-refresh')).default;RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const {ensureLanguageLoaded}=await import('/src/i18n/index.ts');await ensureLanguageLoaded('zh');
      const {DialogProvider}=await import('/src/hooks/useDialog.tsx');
      const {TooltipProvider}=await import('/src/components/ui/tooltip.tsx');
      const {Header}=await import('/src/components/Header.tsx');
      const {useAppStore}=await import('/src/store/useAppStore.ts');
      const {ensureThemeStyleTag,applyThemePreset}=await import('/src/lib/themePresets.ts');ensureThemeStyleTag();applyThemePreset('default');
      const {DailyReadingView}=await import(before?'/output/daily-reading-clean-20261006/reference/DailyReadingView.tsx':'/src/components/reading/DailyReadingView.tsx');
      window.fixtureRoot?.unmount();document.body.innerHTML='<div id="fixture-root"></div>';
      function Shell(){const view=useAppStore(s=>s.currentView);return React.createElement('div',{className:'min-h-screen bg-background text-foreground'},React.createElement(Header),React.createElement('main',{className:'max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3'},view==='reading'?React.createElement(DailyReadingView):React.createElement('p',{id:'other-view'},view)));}
      window.fixtureRoot=createRoot(document.getElementById('fixture-root'));
      window.fixtureRoot.render(React.createElement(DialogProvider,null,React.createElement(TooltipProvider,null,React.createElement(Shell))));
    }''',before)

def run():
    reference()
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        context=browser.new_context(viewport={'width':1440,'height':1000},locale='zh-CN')
        requests=[];errors=[]
        def route(r):
            u=urlparse(r.request.url)
            if u.netloc==urlparse(BASE).netloc and u.path=='/fixture':
                r.fulfill(body='<!doctype html><link rel="stylesheet" href="/src/index.css"><div id="root"></div>',content_type='text/html');return
            if u.netloc==urlparse(BASE).netloc and not u.path.startswith('/api'):r.continue_();return
            requests.append({'method':r.request.method,'url':r.request.url});r.fulfill(status=503,json={'error':'isolated test'})
        context.route('**/*',route)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(e.stack or str(e)))
        page.goto(BASE+'/fixture')
        repos=[fixture.repository(i) for i in range(1,5001)]
        print('seed isolated 5000 records',flush=True)
        page.evaluate('''async repos=>{
          const {useAppStore}=await import('/src/store/useAppStore.ts');await useAppStore.persist.rehydrate();
          useAppStore.setState({githubToken:'isolated',isAuthenticated:true,user:{id:42,login:'fixture'},repositories:repos.slice(0,600),discoveryRepos:{trending:repos.slice(600)},discoveryLastRefresh:{},language:'zh',theme:'light',themePreset:'default',currentView:'reading',aiConfigs:[],customCategories:[],hiddenDefaultCategoryIds:[],defaultCategoryOverrides:{}});
          const {candidateTransaction}=await import('/src/lib/html-reading/candidates.ts');
          await candidateTransaction('42',data=>{for(const repo of repos){const id=String(repo.id);data.names[id]=repo.full_name;data.states[id]={candidate:repo.id%5===0,read:repo.id%2===0,interest:repo.id%3===0?'interested':'neutral',note:repo.id%4===0?'隔离测试笔记，保留已有资料。':''};}});
        }''',repos)
        mount(page,True)
        listing=page.get_by_label('阅读项目列表',exact=True)
        expect(listing.locator('article')).to_have_count(40,timeout=90000)
        page.screenshot(path=str(OUT/'HTML-同数据-改造前.png'))
        mount(page)
        expect(listing.locator('article')).to_have_count(40,timeout=90000)
        expect(page.get_by_role('heading',name='HTML',exact=True)).to_be_visible()
        expect(page.get_by_role('checkbox')).to_have_count(0)
        expect(page.get_by_role('textbox',name='编辑项目笔记')).to_have_count(0)
        page.screenshot(path=str(OUT/'HTML-项目-浅色.png'))
        print('test pagination, selection, resizing and scroll',flush=True)
        page.get_by_role('button',name='选择',exact=True).click()
        page.get_by_role('button',name='选择全部 5000 个匹配项目',exact=True).click()
        expect(page.get_by_text('跨页已选 5000 个',exact=True)).to_be_visible()
        page.get_by_role('button',name='下一页',exact=True).last.click()
        expect(page.get_by_role('checkbox')).to_have_count(40)
        page.get_by_role('button',name='Star 已选项目',exact=True).click()
        dialog=page.get_by_role('dialog');expect(dialog.locator('li')).to_have_count(40)
        page.screenshot(path=str(OUT/'HTML-批量确认.png'))
        dialog.get_by_role('button',name='取消',exact=True).first.click()
        page.get_by_role('button',name='退出并清空选择',exact=True).click()
        expect(page.get_by_role('checkbox')).to_have_count(0)
        separator=page.get_by_role('separator',name='调整列表与详情宽度')
        ratio=separator.get_attribute('aria-valuenow');separator.focus();page.keyboard.press('ArrowRight')
        assert int(separator.get_attribute('aria-valuenow'))>int(ratio)
        box=separator.bounding_box();page.mouse.move(box['x']+3,box['y']+60);page.mouse.down();page.mouse.move(box['x']+50,box['y']+60);page.mouse.up()
        listing.evaluate('e=>{e.scrollTop=220;e.dispatchEvent(new Event("scroll",{bubbles:true}));}')
        mount(page);expect(listing.locator('article')).to_have_count(40)
        page.wait_for_function('Math.abs(document.querySelector(".reading-project-list").scrollTop-220)<3')
        page.get_by_role('button',name='下一页',exact=True).last.click()
        assert listing.evaluate('e=>e.scrollTop')==0
        page.get_by_label('搜索项目名称与已保存笔记',exact=True).fill(repos[-1]['full_name'])
        expect(listing.locator('article')).to_have_count(1)
        listing.get_by_role('button').first.click()
        page.get_by_role('button',name='我的笔记',exact=True).click()
        note=page.get_by_role('textbox',name='编辑项目笔记',exact=True);note.fill('保留的笔记草稿')
        page.get_by_role('dialog').get_by_role('button',name='取消',exact=True).click()
        page.get_by_role('button',name='我的笔记',exact=True).click();expect(note).to_have_value('保留的笔记草稿')
        page.get_by_role('button',name='保存笔记',exact=True).click();expect(page.get_by_text('笔记已保存',exact=True)).to_be_visible()
        page.screenshot(path=str(OUT/'HTML-笔记面板.png'))
        page.get_by_role('dialog').get_by_role('button',name='取消',exact=True).click()
        page.get_by_label('搜索项目名称与已保存笔记',exact=True).fill('')
        page.get_by_role('button',name='配置',exact=True).click()
        expect(page.get_by_role('button',name=re.compile('^内容与频道'))).to_be_visible()
        expect(page.get_by_role('combobox',name='阅读预设')).to_have_count(0)
        page.screenshot(path=str(OUT/'HTML-配置总览.png'))
        page.get_by_role('button',name=re.compile('^内容与频道')).click()
        page.get_by_role('textbox',name='HTML 标题',exact=True).fill('草稿测试')
        page.get_by_role('button',name='返回配置',exact=True).click()
        page.get_by_role('button',name=re.compile('^阅读与手机操作')).click()
        page.get_by_role('button',name='返回配置',exact=True).click()
        page.get_by_role('button',name=re.compile('^内容与频道')).click()
        expect(page.get_by_role('textbox',name='HTML 标题',exact=True)).to_have_value('草稿测试')
        page.get_by_role('navigation').first.get_by_role('button',name='仓库',exact=True).click()
        expect(page.get_by_role('dialog')).to_contain_text('未保存')
        page.get_by_role('button',name='留在页面',exact=True).first.click()
        page.get_by_role('button',name='保存修改',exact=True).click()
        expect(page.get_by_role('button',name='保存修改',exact=True)).to_have_count(0)
        page.get_by_role('button',name='日报',exact=True).click()
        page.screenshot(path=str(OUT/'HTML-日报.png'))
        page.get_by_role('button',name='项目',exact=True).click()
        page.wait_for_timeout(5200)
        print('test widths, themes and scaling in actual outer layout',flush=True)
        widths=[768,1024,1280,1440,1920];measurements=[]
        for dark in [False,True]:
            page.evaluate('dark=>document.documentElement.classList.toggle("dark",dark)',dark)
            for width in widths:
                page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(160)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,dark)
                assert listing.locator('article').count()<=40
                narrow=page.locator('.reading-project-grid').evaluate('e=>e.classList.contains("narrow")')
                if narrow:
                    if not listing.is_visible():page.get_by_role('button',name='返回列表',exact=True).click()
                    listing.get_by_role('button').first.click()
                    expect(page.get_by_label('项目详情',exact=True)).to_be_visible()
                    page.get_by_role('button',name='返回列表',exact=True).click()
                    expect(listing).to_be_visible()
                page.screenshot(path=str(OUT/f'HTML-项目-{width}-{"深色" if dark else "浅色"}.png'))
                measurements.append({'width':width,'dark':dark,'narrow':narrow,'listRows':listing.locator('article').count()})
        page.evaluate('document.documentElement.classList.remove("dark")')
        page.set_viewport_size({'width':1280,'height':900})
        for zoom in [1.25,1.5]:
            page.evaluate('z=>document.documentElement.style.zoom=z',zoom);page.wait_for_timeout(160)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),zoom
            if not listing.is_visible():page.get_by_role('button',name='返回列表',exact=True).click()
            listing.get_by_role('button').first.click()
            if page.locator('.reading-project-grid').evaluate('e=>e.classList.contains("narrow")'):
                page.get_by_role('button',name='返回列表',exact=True).click()
            page.screenshot(path=str(OUT/f'HTML-项目-缩放{int(zoom*100)}.png'))
        assert not errors,errors
        assert not [r for r in requests if r['method'] in ['PUT','DELETE','POST']],requests
        report={'passed':True,'syntheticRecords':5000,'sameDataBeforeAfter':True,'actualHeaderAndProviders':True,'widths':measurements,'scaling':[125,150],'maxListRows':40,'crossPageSelectAll':True,'cancelNoStar':True,'columnKeyboardAndPointer':True,'scrollRestore':True,'pageChangeResetsScroll':True,'noteDraftAndSave':True,'configurationDraftAndLeaveGuard':True,'realGitHubStar':False,'realGmail':False,'pageErrors':errors,'blockedRequests':len(requests)}
        (OUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()
        print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':run()
