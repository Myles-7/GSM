"""Disposable synthetic desktop profile and standalone HTML round-trip. No real mail or account."""
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

OUT=Path(__file__).resolve().parents[1]/'output/html-reading'
OUT.mkdir(parents=True,exist_ok=True)
base='http://127.0.0.1:4178'
repos=[{'id':i,'name':f'tool-{i}','full_name':f'fixture/tool-{i}','html_url':f'https://github.com/fixture/tool-{i}',
  'description':'开放的项目资料管理工具，提供检索、记录和离线阅读。','owner':{'login':'fixture','avatar_url':base+'/icon.svg'},
  'language':'TypeScript','stargazers_count':1000-i,'forks_count':10,'forks':10,'created_at':'2025-01-01T00:00:00Z','updated_at':'2026-09-30T00:00:00Z','pushed_at':'2026-09-30T00:00:00Z',
  'topics':['developer-tools'],'category_id':'dev-tools','private':False,'archived':False,'disabled':False,'default_branch':'main','ai_summary':'这个项目把仓库资料、AI 分析和阅读笔记整理到一个界面中，适合收藏开源工具、比较方案和保存研究结论。支持本机离线浏览，减少反复打开 GitHub 查找资料的时间。',
  'ai_details':{'summary':'项目资料整理工具','features':['离线阅读','项目检索'],'scenarios':['发现开发工具'],'problem':'降低理解开源项目所需时间','architecture':None,'quickstart':[],'deployment':None,'cost':None,'maintenance':None,'sources':[{'label':'README','url':'https://github.com/fixture/tool-'+str(i),'retrieved_at':'2026-09-30T00:00:00Z'}],'generated_at':'2026-09-30T00:00:00Z','version':1,'model':'existing-only','repository_pushed_at':None}} for i in range(1,91)]
state={'user':{'id':42,'login':'fixture','name':'Fixture User','avatar_url':base+'/icon.svg','html_url':'https://github.com/fixture'},'githubToken':'synthetic-no-credential','isAuthenticated':True,'repositories':repos,'lastSync':'2026-09-30T00:00:00Z','language':'zh','theme':'light','themePreset':'default','currentView':'settings','repositoryViewMode':'list','syncModeConfigured':True,'customCategories':[],'subcategories':[],'categoryOrder':[],'hiddenDefaultCategoryIds':[],'accountWorkspaces':{},'routeMode':'browser','aiConfigs':[],'activeAIConfig':None,'discoveryRepos':{'trending':[dict(r,channel='trending',rank=i+1,platform='All') for i,r in enumerate(repos[:12])]},'discoveryLastRefresh':{'trending':'2026-09-30T00:00:00Z'}}
with sync_playwright() as p:
  browser=p.chromium.launch(channel='chrome',headless=True)
  context=browser.new_context(viewport={'width':1280,'height':900},locale='zh-CN',accept_downloads=True)
  page=context.new_page(); errors=[];external=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
    u=urlparse(r.request.url)
    if u.scheme=='file':r.continue_();return
    if u.netloc==urlparse(base).netloc and u.path=='/fixture':r.fulfill(body='<!doctype html>',content_type='text/html');return
    if u.netloc==urlparse(base).netloc and not u.path.startswith('/api'):r.continue_();return
    external.append(u.netloc+u.path);r.fulfill(status=503,json={'error':'synthetic provider disabled'})
  context.route('**/*',route)
  page.goto(base+'/fixture')
  page.evaluate('''async state=>{await new Promise((resolve,reject)=>{const req=indexedDB.open('github-stars-manager-db',1);req.onupgradeneeded=()=>req.result.createObjectStore('app_state');req.onsuccess=()=>{const db=req.result;const tx=db.transaction('app_state','readwrite');tx.objectStore('app_state').put(JSON.stringify({state,version:16}),'github-stars-manager');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});sessionStorage.setItem('gsm:pending-settings-tab','htmlReading');}''',state)
  page.goto(base)
  expect(page.get_by_role('heading',name='每日 HTML',exact=True)).to_be_visible(timeout=30000)
  page.evaluate('''async data=>{const {useAppStore}=await import('/src/store/useAppStore.ts');useAppStore.setState({discoveryRepos:data.repos,discoveryLastRefresh:data.refreshes});}''',{'repos':state['discoveryRepos'],'refreshes':state['discoveryLastRefresh']})
  expect(page.get_by_role('button',name='预览 HTML',exact=True)).to_be_enabled()
  page.screenshot(path=str(OUT/'desktop-settings-content.png'))
  page.get_by_role('button',name='保存设置',exact=True).click()
  expect(page.get_by_text('设置已保存。预览、导出和定时邮件将使用这些内容设置。')).to_be_visible()
  with page.expect_download() as download_info:page.get_by_role('button',name='导出 HTML',exact=True).click()
  file=OUT/'GSM-synthetic-reading.html';download_info.value.save_as(file)
  page.get_by_role('button',name='预览 HTML',exact=True).click()
  expect(page.get_by_role('dialog',name='实际 HTML 预览')).to_be_visible()
  frame=page.frame_locator('iframe[title="每日 HTML 预览"]')
  expect(frame.locator('.reading-section[data-section="repositories"] .project:visible')).to_have_count(40)
  frame.get_by_role('button',name='发现',exact=True).click()
  expect(frame.locator('.reading-section[data-section="trending"] .project:visible')).to_have_count(12)
  page.screenshot(path=str(OUT/'desktop-html-preview.png'))
  page.get_by_role('dialog').get_by_role('button',name='Close',exact=True).click()
  reader=context.new_page();reader.on('pageerror',lambda e:errors.append(str(e)));reader.goto(file.as_uri());reader.set_viewport_size({'width':390,'height':844})
  expect(reader.locator('.reading-section[data-section="repositories"] .project:visible')).to_have_count(40)
  reader.locator('.reading-section[data-section="repositories"] .load-more').click()
  expect(reader.locator('.reading-section[data-section="repositories"] .project:visible')).to_have_count(80)
  reader.get_by_label('搜索项目').fill('tool-1')
  expect(reader.locator('.reading-section[data-section="repositories"] .project:visible')).to_have_count(11)
  reader.get_by_label('搜索项目').fill('')
  card=reader.locator('.reading-section[data-section="repositories"] .project').first
  card.locator('details').last.locator('summary').click()
  card.get_by_label('已读标记').check();card.get_by_label('收藏候选').check();card.get_by_label('兴趣').select_option('interested');card.get_by_label('阅读笔记').fill('适合研究离线知识管理，回电脑后继续比较。')
  reader.get_by_role('button',name='导出修改').click()
  payload=reader.get_by_label('回传文本').input_value()
  assert len(json.loads(payload)['operations'])==4
  reader.get_by_role('button',name='关闭',exact=True).click()
  reader.reload();expect(reader.locator('.reading-section[data-section="repositories"] .project').first.get_by_label('已读标记')).to_be_checked()
  layouts=[]
  for theme in ['light','dark']:
    for width in [360,390,430,768,1024]:
      reader.set_viewport_size({'width':width,'height':844});reader.evaluate('(theme)=>document.body.dataset.theme=theme',theme)
      for label,slug in [('仓库','repositories'),('发现','discovery')]:
        reader.get_by_role('button',name=label,exact=True).click()
        assert reader.evaluate('document.documentElement.scrollWidth<=innerWidth')
        reader.screenshot(path=str(OUT/f'html-{slug}-{width}-{theme}.png'))
        layouts.append({'theme':theme,'width':width,'page':slug,'noOverflow':True})
  page.get_by_label('手机回传文本').fill(payload);page.get_by_role('button',name='预览回传修改').click()
  expect(page.get_by_text('4 项可应用 · 0 项冲突 · 0 项重复')).to_be_visible()
  page.get_by_role('button',name='确认导入',exact=True).click()
  expect(page.get_by_text('已应用 4 项，重复跳过 0 项，保留桌面 0 项。收藏候选尚未执行 Star。')).to_be_visible()
  expect(page.get_by_role('button',name='确认 Star',exact=True)).to_be_visible()
  page.get_by_role('button',name='预览回传修改').click();expect(page.get_by_text('0 项可应用 · 0 项冲突 · 4 项重复')).to_be_visible()
  page.screenshot(path=str(OUT/'desktop-import-receipt.png'))
  assert not errors,errors
  report={'passed':True,'scope':'Synthetic desktop and file:// Chrome; no Gmail or phone validation','layouts':layouts,'projectCount':90,'discoveryCount':12,'renderedInitially':40,'afterLoadMore':80,'operationsImported':4,'repeatImportDeduplicated':True,'fileOriginPersistenceInThisChrome':True,'scriptInjectionErrors':errors,'noPaidProviderCalls':True}
  (OUT/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=True));browser.close()
