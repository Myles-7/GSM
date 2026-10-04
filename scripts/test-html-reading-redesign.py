"""Isolated desktop/file:// verification. Synthetic data; no mail, Star or model calls."""
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/html-reading-redesign-20261003'
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('GSM_READING_TEST_URL', 'http://127.0.0.1:4183')
NOW = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def repository(i):
    names = ['Paperless-ngx', 'Ollama', 'Stirling-PDF', 'GSM', 'Immich', 'n8n']
    name = names[(i-1) % len(names)] + (f'-{i}' if i > 6 else '')
    summary = [
        '把扫描件、发票和电子文档整理成可搜索的个人档案库。通过 OCR 提取文字，自动识别标题、日期和标签，支持全文检索与浏览器上传，适合减少纸质文件查找和归档的时间。可以在自己的电脑或家用服务器部署。',
        '在个人电脑上运行和管理大语言模型的工具。提供模型下载、命令行对话以及兼容的 API，便于把本地模型接入聊天、资料总结或开发工具；数据可留在本机，实际性能取决于电脑内存和显卡。',
        '可以自己部署的 PDF 工具箱，把合并、拆分、压缩、转换和 OCR 等常见操作集中到一个网页里。适合处理个人文件或团队日常文档，避免为了每个 PDF 操作安装单独软件。',
    ][(i-1) % 3]
    return {'id': i, 'name': name, 'full_name': f'fixture/{name}', 'html_url': f'https://github.com/fixture/{name}',
            'owner': {'login': 'fixture', 'avatar_url': BASE+'/icon.svg'}, 'description': '原始项目描述，用于详情补充；列表优先展示已有分析。',
            'language': ['Python', 'Go', 'TypeScript'][(i-1)%3], 'stargazers_count': 12000-i*12,
            'forks_count': 42, 'forks': 42, 'created_at': '2025-01-01T00:00:00Z', 'updated_at': NOW, 'pushed_at': NOW,
            'topics': ['self-hosted', 'productivity', 'open-source', 'developer-tools'], 'category_id': 'dev-tools',
            'private': False, 'archived': False, 'disabled': False, 'default_branch': 'main', 'ai_summary': summary,
            'ai_details': {'version': 1, 'summary': summary, 'problem': '降低资料处理与开源项目了解成本。',
                'features': ['集中管理资料并保留原始内容', '提供清晰的搜索与浏览入口', '支持自己部署，数据保存在用户设备'],
                'scenarios': ['个人资料管理', '研究和比较开源工具'], 'architecture': '网页界面与独立服务组成，使用本机持久存储。',
                'quickstart': [{'description': '下载项目并启动服务', 'command': 'docker compose up -d'}, {'description': '打开本机网页完成初始配置', 'command': None}],
                'deployment': '支持在个人电脑或家庭服务器自行部署。', 'cost': '软件开源，运行成本主要来自电脑与存储。',
                'maintenance': '请以项目的提交记录和 GitHub 说明核对实际维护情况。',
                'sources': [{'label': '项目 README', 'url': f'https://github.com/fixture/{name}#readme', 'retrieved_at': NOW}],
                'generated_at': NOW, 'model': 'already-saved-fixture', 'repository_pushed_at': NOW}}

def install_fixture(page, repos):
    state = {'user': {'id': 42, 'login': 'fixture', 'name': 'Fixture User', 'avatar_url': BASE+'/icon.svg', 'html_url': 'https://github.com/fixture'},
             'githubToken': 'synthetic-no-credential', 'isAuthenticated': True, 'repositories': repos, 'lastSync': NOW,
             'language': 'zh', 'theme': 'light', 'themePreset': 'default', 'currentView': 'repositories', 'repositoryViewMode': 'list',
             'syncModeConfigured': True, 'customCategories': [], 'subcategories': [], 'categoryOrder': [], 'hiddenDefaultCategoryIds': [],
             'accountWorkspaces': {}, 'routeMode': 'browser', 'aiConfigs': [], 'activeAIConfig': None,
             'discoveryRepos': {'trending': [dict(r, channel='trending', rank=i+1, platform='All') for i, r in enumerate(repos[:12])]},
             'discoveryLastRefresh': {'trending': NOW}}
    page.goto(BASE+'/fixture')
    page.evaluate('''async state => {
      await new Promise((resolve,reject)=>{const req=indexedDB.open('github-stars-manager-db',1);req.onupgradeneeded=()=>req.result.createObjectStore('app_state');req.onsuccess=()=>{const db=req.result;const tx=db.transaction('app_state','readwrite');tx.objectStore('app_state').put(JSON.stringify({state,version:16}),'github-stars-manager');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
    }''', state)
    page.goto(BASE,wait_until='domcontentloaded',timeout=120000)
    page.wait_for_function("!!document.getElementById('root')?.firstElementChild",timeout=60000)
    page.evaluate('''async state => {const {useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState(state);}''', state)
    return state

def generate(page, overrides=None):
    return page.evaluate('''async overrides => {
      const {defaultSettings}=await import('/src/lib/html-reading/model.ts');
      const {generateReadingSnapshot}=await import('/src/services/htmlReading.ts');
      return generateReadingSnapshot({...defaultSettings, channelIds:['trending','custom:reading'], ...overrides});
    }''', overrides or {})

def export_payload(reader):
    reader.locator('#export').click()
    expect(reader.locator('#return-dialog')).to_be_visible()
    payload = reader.get_by_label('回传文本').input_value()
    reader.locator('#close-export').click()
    expect(reader.locator('#return-dialog')).to_be_hidden()
    return json.loads(payload)

def write_sample(output, name):
    path = OUT/name
    path.write_text(output['html'], encoding='utf-8', newline='')
    assert path.stat().st_size == output['bytes'], (name, path.stat().st_size, output['bytes'])
    return path

def run():
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        context=browser.new_context(viewport={'width':1280,'height':900},locale='zh-CN',accept_downloads=True)
        errors=[]; blocked=[]
        def route(r):
            u=urlparse(r.request.url)
            if u.scheme=='file': r.continue_(); return
            if u.netloc==urlparse(BASE).netloc and u.path=='/fixture': r.fulfill(body='<!doctype html>',content_type='text/html'); return
            if u.netloc==urlparse(BASE).netloc and not u.path.startswith('/api'): r.continue_(); return
            blocked.append(u.netloc+u.path); r.fulfill(status=503,json={'error':'synthetic provider disabled'})
        context.route('**/*',route)
        page=context.new_page();page.on('pageerror',lambda e: errors.append(str(e)))
        repos=[repository(i) for i in range(1,91)]
        state=install_fixture(page,repos)
        page.screenshot(path=str(OUT/'desktop-repositories-same-data.png'))
        editions=[]
        for age in [0,1]:
            day=(datetime.now(timezone.utc)-timedelta(days=age)).date().isoformat()
            editions.append({'channelId':'custom:reading','date':day,'revision':1,'instruction':'关注可以自己部署的成熟工具','complete':True,
                'generatedAt':(datetime.now(timezone.utc)-timedelta(days=age)).isoformat(),'entries':[{'repo':r,'reason':'适合个人电脑与家庭服务器上的资料管理。','verdict':'match','evidence':[],'method':'rules','relevance':1,'preference':1} for r in repos[:8]],'pending':[],'errors':[],'searched':8,'filtered':0})
        page.evaluate('''async data=>{const {transact}=await import('/src/features/discovery/custom/storage.ts');await transact('42',d=>{d.channels=[{id:'custom:reading',name:'自部署工具'}];d.editions=data;});}''',editions)
        sample=generate(page)
        file=write_sample(sample,'GSM-新版阅读示例.html')
        assert sample['snapshot']['version']==2
        assert len(sample['snapshot']['items'])==90
        assert len(sample['snapshot']['sections'][-1]['editions'])==2
        reader=context.new_page();reader.on('pageerror',lambda e: errors.append(str(e)))
        reader.set_viewport_size({'width':390,'height':844});reader.goto(file.as_uri())
        expect(reader.locator('#project-grid .project')).to_have_count(40)
        # Detailed interactions are intentionally based on the generated reader's actual selectors.
        reader.locator('[data-open="1"]').click()
        expect(reader.locator('#detail-page')).to_be_visible()
        expect(reader.locator('#detail-content')).to_contain_text('集中管理资料')
        reader.screenshot(path=str(OUT/'html-detail-overview-390-light.png'))
        reader.get_by_role('tab',name='使用',exact=True).click()
        expect(reader.locator('#detail-content')).to_contain_text('docker compose up -d')
        reader.screenshot(path=str(OUT/'html-detail-usage-390-light.png'))
        reader.get_by_label('阅读笔记').fill('适合研究离线知识管理，回电脑后继续比较。')
        reader.locator('#detail-back').click()
        reader.locator('.project[data-id="1"] [data-action="interest"]').click()
        reader.locator('.project[data-id="1"] [data-action="candidate"]').click()
        first=export_payload(reader)
        assert first['version']==2 and len(first['operations'])==4, first
        reader.reload()
        reader.locator('[data-open="1"]').click()
        expect(reader.get_by_label('阅读笔记')).to_have_value('适合研究离线知识管理，回电脑后继续比较。')
        reader.locator('#detail-back').click()
        # Same file navigation, independent channel searches and edition selection.
        reader.locator('#search-toggle').click()
        reader.get_by_label('搜索项目').fill('Ollama')
        reader.locator('[data-page="discovery"]').click()
        expect(reader.get_by_label('搜索项目')).to_have_value('')
        reader.get_by_role('button',name='自部署工具',exact=True).click()
        expect(reader.get_by_label('选择期刊')).to_be_visible()
        reader.get_by_label('选择期刊').select_option(index=1)
        expect(reader.locator('#project-grid .project')).to_have_count(8)
        reader.locator('[data-page="repositories"]').click()
        expect(reader.get_by_label('搜索项目')).to_have_value('Ollama')
        reader.get_by_label('搜索项目').fill('')
        reader.locator('#load-more').click()
        reader.locator('#load-more').click()
        assert reader.locator('#project-grid .project').count() <= 120
        reader.evaluate('window.scrollTo(0,5000)')
        reader.wait_for_timeout(300)
        saved_payload=export_payload(reader)
        imported=page.evaluate('''async input=>{const {applyReadingReturn}=await import('/src/lib/html-reading/storage.ts');return applyReadingReturn('42',input,{});}''',saved_payload)
        repeated=page.evaluate('''async input=>{const {applyReadingReturn}=await import('/src/lib/html-reading/storage.ts');return applyReadingReturn('42',input,{});}''',saved_payload)
        assert imported['applied']==4 and repeated['duplicate']==4
        assert repeated['positionApplied']==0
        next_output=generate(page)
        assert next_output['snapshot']['resume']
        next_reader=context.new_page();next_reader.goto(write_sample(next_output,'GSM-继续阅读示例.html').as_uri())
        expect(next_reader.locator('#project-grid')).to_be_visible()
        next_reader.wait_for_timeout(250)
        resumed=next_output['snapshot']['resume'][0]
        resumed_card=next_reader.locator(f'.project[data-id="{resumed["repoId"]}"]')
        expect(resumed_card).to_be_visible()
        resumed_box=resumed_card.bounding_box()
        assert resumed_box and resumed_box['y'] < next_reader.viewport_size['height']
        untouched=export_payload(next_reader)
        assert untouched['operations']==[] and untouched['positions']==[] and untouched['activeView'] is None
        # Going into a project and returning preserves the same visible anchor and offset.
        reader.evaluate('window.scrollTo(0,1800)');reader.wait_for_timeout(200)
        visible=reader.locator('.project').evaluate_all('''els=>{const header=document.querySelector('.app-header').getBoundingClientRect().bottom;const e=els.find(e=>e.getBoundingClientRect().top>=header && e.getBoundingClientRect().top<innerHeight-150);return {id:e.dataset.id,y:e.getBoundingClientRect().top};}''')
        reader.locator(f'[data-open="{visible["id"]}"]').click()
        expect(reader.locator('#detail-page')).to_be_visible()
        reader.locator('#detail-back').click()
        expect(reader.locator('#detail-page')).to_be_hidden()
        reader.wait_for_timeout(200)
        after=reader.locator(f'.project[data-id="{visible["id"]}"]').bounding_box()
        assert after and abs(after['y']-visible['y']) < 3, (visible,after)
        reader.locator('#category-open').click()
        expect(reader.locator('#drawer')).to_be_visible()
        reader.go_back();expect(reader.locator('#drawer')).to_be_hidden()
        # Same-data desktop discovery and analysis screenshots, without provider requests.
        page.get_by_role('navigation').first.get_by_role('button',name='发现',exact=True).click()
        page.evaluate('''async()=>{const {useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState({selectedDiscoveryChannel:'trending'});}''')
        expect(page.get_by_role('heading',name='趋势',exact=True)).to_be_visible(timeout=30000)
        page.wait_for_timeout(300)
        page.evaluate('''async repos=>{const {useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState({discoveryRepos:{...useAppStore.getState().discoveryRepos,trending:repos},discoveryLastRefresh:{...useAppStore.getState().discoveryLastRefresh,trending:new Date().toISOString()}});}''',state['discoveryRepos']['trending'])
        expect(page.locator('article[aria-label="fixture/Paperless-ngx"]').first).to_be_visible(timeout=30000)
        page.screenshot(path=str(OUT/'desktop-discovery-same-data.png'))
        page.get_by_role('navigation').first.get_by_role('button',name='仓库',exact=True).click()
        desktop_card=page.locator('.repository-card').filter(has=page.get_by_role('heading',name='Paperless-ngx',exact=True)).first
        expect(desktop_card).to_be_visible();desktop_card.press('Enter')
        expect(page.get_by_text('集中管理资料并保留原始内容',exact=True)).to_be_visible()
        page.get_by_role('dialog').wait_for(state='visible')
        page.wait_for_timeout(250)
        page.screenshot(path=str(OUT/'desktop-detail-same-data.png'),animations='disabled')
        page.get_by_role('dialog').get_by_role('button',name='关闭详情',exact=True).click()
        expect(page.get_by_role('dialog')).to_be_hidden()
        # Settings preview renders the actual output in an isolated sandbox.
        page.evaluate("sessionStorage.setItem('gsm:pending-settings-tab','htmlReading')")
        page.get_by_role('navigation').first.get_by_role('button',name='设置',exact=True).click()
        expect(page.get_by_role('heading',name='每日 HTML',exact=True)).to_be_visible(timeout=30000)
        page.screenshot(path=str(OUT/'desktop-settings-content.png'))
        page.get_by_role('button',name='预览 HTML',exact=True).click()
        expect(page.get_by_role('dialog',name='实际 HTML 预览')).to_be_visible()
        preview=page.frame_locator('iframe[title="每日 HTML 预览"]')
        expect(preview.locator('#project-grid .project')).to_have_count(40)
        page.get_by_role('button',name='预览深色',exact=True).click()
        expect(preview.locator('body')).to_have_attribute('data-mode','dark')
        page.get_by_role('button',name='预览宽度 430px',exact=True).click()
        expect(page.locator('iframe[title="每日 HTML 预览"]')).to_have_css('width','430px')
        page.wait_for_function("document.querySelector('iframe[title=\"每日 HTML 预览\"]').getBoundingClientRect().width===430")
        preview.locator('html').evaluate('''async el=>{if(innerWidth!==430||el.clientWidth!==430)throw Error('Wrong preview viewport');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}''')
        page.wait_for_timeout(250)
        preview_metrics=page.locator('iframe[title="每日 HTML 预览"]').evaluate('e=>({css:getComputedStyle(e).width,width:e.getBoundingClientRect().width})')
        page.locator('iframe[title="每日 HTML 预览"]').screenshot(path=str(OUT/'desktop-html-preview-frame.png'))
        page.screenshot(path=str(OUT/'desktop-html-preview.png'),animations='disabled')
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog',name='实际 HTML 预览')).to_be_hidden()
        # Compare the same desktop data in both pages, across all requested sizes/modes.
        layouts=[]
        for theme in ['light','dark']:
            for width in [360,390,430,768,1024]:
                reader.set_viewport_size({'width':width,'height':844})
                reader.evaluate('(theme)=>document.body.dataset.mode=theme',theme)
                for slug in ['repositories','discovery']:
                    reader.locator(f'[data-page="{slug}"]').click()
                    reader.wait_for_timeout(100)
                    reader.evaluate('window.scrollTo(0,0)');reader.wait_for_timeout(100)
                    assert reader.evaluate('document.documentElement.scrollWidth<=innerWidth'), (theme,width,slug)
                    expect(reader.locator('.app-header')).to_be_visible()
                    reader.evaluate('''async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}''')
                    reader.wait_for_timeout(250)
                    screenshot=reader.screenshot(path=str(OUT/f'html-{slug}-{width}-{theme}.png'),animations='disabled')
                    assert len(screenshot)>10000, ('Empty screenshot',theme,width,slug)
                    layouts.append({'width':width,'theme':theme,'page':slug,'noOverflow':True})
        reader.set_viewport_size({'width':360,'height':844})
        reader.evaluate("document.body.style.setProperty('--size','20px')")
        reader.locator('[data-page="repositories"]').click()
        reader.wait_for_timeout(100);reader.evaluate('window.scrollTo(0,0)');reader.wait_for_timeout(100)
        assert reader.evaluate('document.documentElement.scrollWidth<=innerWidth')
        reader.screenshot(path=str(OUT/'html-repositories-360-font20.png'))
        targets=reader.locator('button:visible').evaluate_all('els=>els.filter(e=>e.getBoundingClientRect().height<43.5).map(e=>({text:e.textContent,height:e.getBoundingClientRect().height}))')
        assert not targets, targets
        reader.set_viewport_size({'width':844,'height':390})
        assert reader.evaluate('document.documentElement.scrollWidth<=innerWidth')
        reader.screenshot(path=str(OUT/'html-repositories-landscape.png'))
        # Storage failure is visible and current notes/positions can still be exported.
        no_store=context.new_page()
        no_store.add_init_script("Object.defineProperty(Storage.prototype,'getItem',{value(){throw new Error('disabled')}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw new Error('disabled')}})")
        no_store.set_viewport_size({'width':390,'height':844});no_store.goto(file.as_uri())
        expect(no_store.locator('#notice')).to_contain_text('保存')
        no_store.locator('[data-open="1"]').click();no_store.get_by_label('阅读笔记').fill('本地保存失败时仍可回传')
        no_store.locator('#detail-back').click();expect(no_store.locator('#detail-page')).to_be_hidden()
        failed_storage_return=export_payload(no_store)
        assert any(op['field']=='note' and op['value']=='本地保存失败时仍可回传' for op in failed_storage_return['operations'])
        no_store.locator('#export').click()
        with no_store.expect_download() as download_info:no_store.locator('#download').click()
        downloaded=OUT/'GSM-浏览器回传示例.json';download_info.value.save_as(downloaded)
        assert json.loads(downloaded.read_text(encoding='utf-8'))['version']==2
        # Large data uses real generation plus file navigation; no full repository DOM.
        large_repos=[repository(i) for i in range(1,5001)]
        page.evaluate('''async repos=>{const {useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState({repositories:repos});}''',large_repos)
        large=generate(page,{'discovery':False,'maxFileMb':15})
        perf=context.new_page();perf.on('pageerror',lambda e: errors.append(str(e)))
        perf.set_viewport_size({'width':390,'height':844})
        started=time.monotonic();perf.goto(write_sample(large,'GSM-5000仓库性能示例.html').as_uri())
        expect(perf.locator('#project-grid .project')).to_have_count(40)
        first_ms=round((time.monotonic()-started)*1000)
        perf.locator('#search-toggle').click()
        started=time.monotonic();perf.get_by_label('搜索项目').fill('Stirling-PDF-4995')
        expect(perf.locator('#project-grid .project')).to_have_count(1)
        search_ms=round((time.monotonic()-started)*1000)
        perf.get_by_label('搜索项目').fill('')
        max_nodes=0
        for _ in range(5):
            perf.mouse.wheel(0,600)
            perf.evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');perf.wait_for_timeout(150)
            max_nodes=max(max_nodes,perf.locator('#project-grid .project').count())
        assert max_nodes<=120
        assert max_nodes==120
        # Rich saved analysis close to the allowed attachment limit, using no new AI.
        for repo in large_repos:
            repo['id']+=10000
            repo['name']+='-rich'
            repo['full_name']+='-rich'
            repo['html_url']+='-rich'
            repo['ai_details']['features'].append('Rich saved analysis fixture. '*32)
        page.evaluate('''async repos=>{const {useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState({repositories:repos});}''',large_repos)
        rich=generate(page,{'discovery':False,'maxFileMb':15})
        assert 0.9 * 15 * 1024 * 1024 < rich['bytes'] <= 15 * 1024 * 1024, rich['bytes']
        rich_file=write_sample(rich,'GSM-丰富分析附件上限示例.html')
        rich_reader=context.new_page();rich_reader.on('pageerror',lambda e: errors.append(str(e)))
        rich_reader.set_viewport_size({'width':390,'height':844});rich_reader.goto(rich_file.as_uri())
        expect(rich_reader.locator('#project-grid .project')).to_have_count(40)
        rich_reader.locator('[data-open="10001"]').click()
        expect(rich_reader.locator('#detail-content')).to_contain_text('Rich saved analysis fixture.')
        rich_reader.get_by_role('tab',name='使用',exact=True).click()
        expect(rich_reader.locator('#detail-content')).to_contain_text('docker compose up -d')
        assert rich_reader.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not errors,errors
        report={'passed':True,'scope':'Isolated synthetic desktop and file:// Chrome; actual Android/Gmail not verified',
                'layouts':layouts,'sameDesktopDataScreenshots':True,'structuredAnalysis':True,'periodHistory':True,
                'businessOperations':4,'repeatImportDeduplicated':True,'crossDailyResume':True,
                'restoredAnchorPixelOffset':True,'inheritedPositionNotExported':True,'storageFailureExport':True,
                'font20AndLandscape':True,'minimumTargetHeightPx':44,'jsonDownload':True,
                'actualSettingsPreview':True,
                'settingsPreviewViewport':preview_metrics,'richFileBytes':rich['bytes'],'richFileLimitMb':15,'richFileOpenAndDetails':True,
                'repositoryCount':5000,'largeFileBytes':large['bytes'],'firstScreenMs':first_ms,'searchMs':search_ms,'maxLiveCards':max_nodes,
                'noPaidProviderCalls':True,'mailSent':False,'pageErrors':errors}
        (OUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=True));browser.close()

if __name__=='__main__': run()
