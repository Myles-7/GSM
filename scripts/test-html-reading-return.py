"""Actual return UI/hooks in an isolated Chromium context. Synthetic data only."""
import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/html-reading-return-20261006'
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('GSM_READING_TEST_URL', 'http://127.0.0.1:4194')
spec = importlib.util.spec_from_file_location('fixture', ROOT/'scripts/test-html-reading-redesign.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.BASE = BASE

def baseline():
    # Review only the committed old UI; no checkout or edits of current source.
    source = subprocess.check_output(['git','show','HEAD:src/components/settings/HtmlReadingImport.tsx'], cwd=ROOT).decode('utf-8')
    import re
    def resolve(match):
        path = (ROOT/'src/components/settings'/match.group(2)).resolve().relative_to(ROOT).as_posix()
        return match.group(1)+'/'+path+match.group(3)
    source = re.sub(r"(from\s+['\"])(\.\.?/[^'\"]+)(['\"])", resolve, source)
    (OUT/'baseline-import.tsx').write_text(source, encoding='utf-8')

def mount(page, module='/src/components/settings/HtmlReadingImport.tsx', count=5000):
    page.evaluate('''async module=>{
      const reactModule=await import('/node_modules/.vite/deps/react.js');const React=reactModule.default??reactModule;
      const domModule=await import('/node_modules/.vite/deps/react-dom_client.js');const {createRoot}=domModule.default??domModule;
      const {useHtmlReading}=await import('/src/features/settings/hooks/useHtmlReading.ts');
      const {HtmlReadingImport}=await import(module);
      const {ensureLanguageLoaded}=await import('/src/i18n/index.ts');await ensureLanguageLoaded('zh');
      function Fixture(){const c=useHtmlReading();window.fixtureC=c;return React.createElement(HtmlReadingImport,{controller:c});}
      window.fixtureRoot?.unmount();document.body.innerHTML='<main id="fixture-root" class="mx-auto max-w-4xl p-6"></main>';
      window.fixtureRoot=createRoot(document.getElementById('fixture-root'));window.fixtureRoot.render(React.createElement(Fixture));
    }''',module)
    page.wait_for_function("count=>window.fixtureC?.candidates?.items.length===count",arg=count,timeout=60000)

def run():
    baseline()
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        context=browser.new_context(viewport={'width':1280,'height':960},locale='zh-CN')
        requests=[];errors=[]
        def route(r):
            u=urlparse(r.request.url)
            if u.netloc==urlparse(BASE).netloc and u.path=='/fixture':
                r.fulfill(body='<!doctype html><link rel="stylesheet" href="/src/index.css"><div id="root"></div>',content_type='text/html');return
            if u.netloc==urlparse(BASE).netloc and not u.path.startswith('/api'):
                r.continue_();return
            requests.append({'method':r.request.method,'url':r.request.url})
            r.fulfill(status=503,json={'error':'isolated fixture: upstream disabled'})
        context.route('**/*',route)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        repos=[fixture.repository(i) for i in range(1,5001)]
        fixture.install_fixture(page,repos)
        page.evaluate('''async repos=>{
          const {candidateTransaction}=await import('/src/lib/html-reading/candidates.ts');
          await candidateTransaction('42',data=>{for(const repo of repos){const id=String(repo.id);data.names[id]=repo.full_name;data.states[id]={candidate:true,read:repo.id%2===0,interest:repo.id%3===0?'interested':'neutral',note:repo.id%4===0?'隔离测试笔记：保留资料，不发送真实请求。':''};}});
        }''',repos)
        mount(page,'/output/html-reading-return-20261006/baseline-import.tsx')
        page.screenshot(path=str(OUT/'导入与候选-改造前.png'),full_page=False)
        start=time.perf_counter();mount(page)
        expect(page.get_by_role('tab',name='导入回传',exact=True)).to_be_visible()
        page.screenshot(path=str(OUT/'导入回传-改造后.png'))
        page.get_by_role('tab',name=re.compile('^Star 候选')).click()
        panel=page.get_by_role('tabpanel',name=re.compile('^Star 候选'))
        expect(panel.locator('article')).to_have_count(40)
        first_screen_ms=round((time.perf_counter()-start)*1000)
        page.screenshot(path=str(OUT/'收藏候选-改造后.png'))
        expect(panel.get_by_text('跨页已选 0 个',exact=True)).to_be_visible()
        panel.get_by_role('button',name='选择全部 5000 个匹配项目',exact=True).click()
        expect(panel.get_by_text('跨页已选 5000 个',exact=True)).to_be_visible()
        panel.get_by_role('button',name='下一页',exact=True).click()
        expect(panel.get_by_text('跨页已选 5000 个',exact=True)).to_be_visible()
        panel.get_by_role('button',name='Star 已选项目',exact=True).click()
        dialog=page.get_by_role('dialog');expect(dialog).to_be_visible()
        expect(dialog.locator('li')).to_have_count(40)
        expect(dialog).to_contain_text('5000')
        dialog.get_by_role('button',name='下一页',exact=True).click()
        expect(dialog.locator('li')).to_have_count(40)
        page.screenshot(path=str(OUT/'批量Star-完整清单确认.png'))
        dialog.get_by_role('button',name='取消',exact=True).first.click()
        assert not [r for r in requests if r['method']=='PUT'],requests
        search=panel.get_by_label('搜索 Star 候选')
        start=time.perf_counter();search.fill(repos[-1]['full_name'])
        expect(panel.locator('article')).to_have_count(1)
        search_ms=round((time.perf_counter()-start)*1000)
        expect(panel.get_by_text('跨页已选 5000 个',exact=True)).to_be_visible()
        panel.get_by_role('button',name='清空选择',exact=True).click()
        panel.get_by_role('checkbox').check()
        panel.get_by_role('button',name='移除已选候选',exact=True).click()
        page.get_by_role('dialog').get_by_role('button',name='确认移除候选',exact=True).click()
        expect(panel.locator('article')).to_have_count(0)
        value=page.evaluate('''async()=>{const {readCandidateWorkspace}=await import('/src/lib/html-reading/candidates.ts');return (await readCandidateWorkspace('42')).states['5000'];}''')
        assert value=={'candidate':False,'read':True,'interest':'neutral','note':'隔离测试笔记：保留资料，不发送真实请求。'},value
        page.get_by_role('tab',name='阅读记录',exact=True).click()
        records=page.get_by_role('tabpanel',name='阅读记录',exact=True)
        expect(records.locator('article')).to_have_count(40)
        records.get_by_label('搜索阅读记录').fill(repos[-1]['full_name'])
        expect(records.locator('article')).to_have_count(1)
        records.locator('summary').click()
        records.get_by_role('button',name='编辑笔记',exact=True).click()
        records.get_by_role('textbox',name='阅读笔记 '+repos[-1]['full_name']).fill('修改后的隔离笔记')
        records.get_by_role('button',name='保存笔记',exact=True).click()
        expect(records.get_by_role('textbox',name='阅读笔记 '+repos[-1]['full_name'])).to_have_count(0)
        records.locator('summary').click()
        expect(records.get_by_role('button',name='编辑笔记',exact=True)).to_be_visible()
        page.screenshot(path=str(OUT/'阅读记录-筛选与折叠笔记.png'))
        page.get_by_role('tab',name=re.compile('^Star 候选')).click()
        expect(search).to_have_value(repos[-1]['full_name'])
        page.get_by_role('tab',name='阅读记录',exact=True).click()
        expect(records.get_by_label('搜索阅读记录')).to_have_value(repos[-1]['full_name'])
        page.reload();mount(page,count=4999)
        persisted=page.evaluate('''async()=>{const {readCandidateWorkspace}=await import('/src/lib/html-reading/candidates.ts');return (await readCandidateWorkspace('42')).states['5000'];}''')
        assert persisted['note']=='修改后的隔离笔记' and not persisted['candidate'],persisted
        payload=page.evaluate('''async()=>{
          const {rememberSnapshot}=await import('/src/lib/html-reading/storage.ts');
          const {defaultSettings}=await import('/src/lib/html-reading/model.ts');
          const {readCandidateWorkspace}=await import('/src/lib/html-reading/candidates.ts');
          const data=await readCandidateWorkspace('42'),state=data.states['5000'],name=data.names['5000'];
          const snapshot={version:1,id:'isolated-return-snapshot',accountId:'42',generatedAt:new Date().toISOString(),title:'隔离回传测试',settings:defaultSettings,sections:[{id:'repositories',title:'收藏仓库',items:[{id:5000,name,state}]}]};
          await rememberSnapshot('42',snapshot);
          return {format:'gsm-reading-changes',version:1,accountId:'42',snapshotId:snapshot.id,operations:[{id:crypto.randomUUID(),repoId:5000,field:'candidate',base:false,value:true},{id:crypto.randomUUID(),repoId:5000,field:'note',base:state.note,value:'手机回传的隔离笔记'}]};
        }''')
        (OUT/'隔离回传示例.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
        page.locator('textarea').first.fill(json.dumps(payload,ensure_ascii=False))
        page.get_by_role('button',name='预览回传修改',exact=True).click()
        expect(page.get_by_role('button',name='确认导入',exact=True)).to_be_enabled()
        page.screenshot(path=str(OUT/'导入回传-实际预览.png'))
        page.get_by_role('button',name='确认导入',exact=True).click()
        expect(page.get_by_role('button',name='查看 Star 候选',exact=True)).to_be_visible()
        page.get_by_role('button',name='查看 Star 候选',exact=True).click()
        panel=page.get_by_role('tabpanel',name=re.compile('^Star 候选'))
        panel.get_by_role('button',name='本次导入',exact=True).click()
        expect(panel.locator('article')).to_have_count(1)
        expect(panel).to_contain_text('手机回传的隔离笔记')
        assert not [r for r in requests if r['method']=='PUT'],requests
        assert not errors,errors
        report={'passed':True,'records':5000,'maxRenderedCandidateRows':40,'maxRenderedConfirmationRows':40,'crossPageSelectAll':True,'filterPreservesSelection':True,'cancelSendsNoStar':True,'bulkRemovalPreservesReadingFields':True,'notePersists':True,'tabPreservesSearch':True,'pasteImportAndSourceFilter':True,'importSendsNoStar':True,'firstScreenMs':first_screen_ms,'searchMs':search_ms,'pageErrors':errors,'networkRequestsBlocked':len(requests),'realGitHubStarVerified':False}
        (OUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()

if __name__=='__main__':run()
