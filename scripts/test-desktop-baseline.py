"""Capture actual desktop React app using a disposable synthetic browser profile.
External requests and all API requests are mocked; no account/provider is contacted.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4177')
parser.add_argument('--inspect', action='store_true')
args = parser.parse_args()
base = args.url.rstrip('/')
origin = urlparse(base).netloc
out = Path(__file__).resolve().parents[1] / 'output' / 'mobile-parity'
out.mkdir(parents=True, exist_ok=True)
repos = [{
    'id': i, 'name': f'repo-{i}', 'full_name': f'fixture/repo-{i}',
    'html_url': f'https://github.com/fixture/repo-{i}',
    'description': 'Build thoughtful tools for your ideas. 轻量、开放的开发工具，让项目研究和知识整理更简单。',
    'owner': {'login': 'fixture', 'avatar_url': base + '/icon.svg'},
    'language': 'TypeScript', 'stargazers_count': 5001-i, 'forks_count': i*11, 'forks': i*11,
    'created_at': '2025-01-01T12:00:00Z', 'updated_at': '2026-09-29T12:00:00Z', 'pushed_at': '2026-09-29T12:00:00Z',
    'topics': ['developer-tools', 'open-source'], 'custom_tags': [], 'category_id': 'dev-tools',
    'ai_summary': 'Build thoughtful tools for your ideas. 轻量、开放的开发工具，让项目研究和知识整理更简单。',
    'custom_description': 'Build thoughtful tools for your ideas. 轻量、开放的开发工具，让项目研究和知识整理更简单。', 'private': False, 'archived': False, 'disabled': False, 'default_branch': 'main',
} for i in range(1, 25)]
state = {
    'user': {'id': 42, 'login': 'fixture', 'name': 'Fixture User', 'avatar_url': base + '/icon.svg', 'html_url': 'https://github.com/fixture'},
    'githubToken': 'synthetic-not-a-real-token', 'isAuthenticated': True, 'repositories': repos,
    'lastSync': '2026-09-29T12:00:00Z', 'language': 'zh', 'theme': 'light', 'themePreset': 'default',
    'repositoryViewMode': 'list', 'currentView': 'repositories', 'selectedCategory': 'all',
    'syncModeConfigured': True, 'syncMode': 'stars', 'customCategories': [], 'subcategories': [],
    'categoryOrder': [], 'hiddenDefaultCategoryIds': [], 'accountWorkspaces': {},
    'routeMode': 'browser', 'backendApiSecret': None, 'aiConfigs': [], 'activeAIConfig': None,
}
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 900}, device_scale_factor=1, locale='zh-CN')
    page = context.new_page()
    errors = []
    requests = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def route_request(route):
        url = urlparse(route.request.url)
        if url.netloc == origin and url.path == '/__desktop_fixture__':
            route.fulfill(body='<!doctype html><title>Isolated fixture bootstrap</title>', content_type='text/html'); return
        if url.netloc == origin and not url.path.startswith('/api'):
            route.continue_(); return
        requests.append({'host': url.netloc, 'path': url.path, 'method': route.request.method})
        if url.netloc == 'api.github.com':
            if '/search/repositories' in url.path: data = {'items': repos, 'total_count': len(repos), 'incomplete_results': False}
            elif url.path == '/user': data = state['user']
            else: data = []
            route.fulfill(json=data, headers={'Access-Control-Allow-Origin': '*'}); return
        route.fulfill(status=503, json={'error': 'Synthetic QA: provider disconnected'}, headers={'Access-Control-Allow-Origin': '*'})
    page.route('**/*', route_request)
    page.goto(base + '/__desktop_fixture__')
    page.evaluate('''async state => {
      await new Promise((resolve,reject) => {
        const request=indexedDB.open('github-stars-manager-db',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('app_state');
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result;const tx=db.transaction('app_state','readwrite');tx.objectStore('app_state').put(JSON.stringify({state,version:16}),'github-stars-manager');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
      });
    }''', state)
    page.goto(base)
    page.wait_for_load_state('networkidle')
    if not args.inspect:
        page.wait_for_function("document.querySelectorAll('.repository-card').length > 0", timeout=30000)
    page.screenshot(path=str(out/'desktop-repositories-light.png'))
    if args.inspect:
        print(json.dumps({'text':page.locator('body').inner_text()[:8500],'errors':errors}, ensure_ascii=True))
    else:
        for theme in ['light','dark']:
            for view, slug in [('repositories','repositories'),('subscription','discovery'),('ai','ai')]:
                page.evaluate('''async ({theme,view,repos}) => {
                  const {useAppStore}=await import('/src/store/useAppStore.ts');
                  const state=useAppStore.getState();
                  useAppStore.setState({theme,currentView:view, repositoryViewMode:'list',
                    discoveryRepos:{...state.discoveryRepos,trending:repos.map((r,index)=>({...r,channel:'trending',rank:index+1,platform:'All',starsToday:25+index}))},
                    discoveryLastRefresh:{...state.discoveryLastRefresh,trending:new Date().toISOString()},
                    discoveryHasMore:{...state.discoveryHasMore,trending:false},
                    discoveryTotalCount:{...state.discoveryTotalCount,trending:repos.length},
                    discoveryIsLoading:{...state.discoveryIsLoading,trending:false}});
                }''', {'theme':theme,'view':view,'repos':repos[:8]})
                page.wait_for_load_state('networkidle')
                page.wait_for_timeout(700)
                if view == 'subscription':
                    page.evaluate('''async repos => {
                      const {useAppStore}=await import('/src/store/useAppStore.ts'); const state=useAppStore.getState();
                      useAppStore.setState({discoveryRepos:{...state.discoveryRepos,trending:repos.map((r,i)=>({...r,channel:'trending',rank:i+1,platform:'All'}))},discoveryIsLoading:{...state.discoveryIsLoading,trending:false}});
                    }''', repos[:8])
                    page.wait_for_timeout(250)
                page.mouse.move(1270,890)
                page.screenshot(path=str(out/f'desktop-{slug}-{theme}.png'))
        report={'fixtureOnly':True,'viewport':{'width':1280,'height':900},'screenshots':[f'desktop-{view}-{theme}.png' for theme in ['light','dark'] for view in ['repositories','discovery','ai']], 'pageErrors':errors,'mockedRequests':requests,'scope':'Actual desktop React app, isolated new Chromium profile, synthetic IndexedDB seed; all providers/API requests intercepted.'}
        (out/'desktop-baseline-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=True))
    browser.close()
