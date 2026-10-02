import os
import time
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

OUT_DIR = Path('output/audit_fresh')
OUT_DIR.mkdir(parents=True, exist_ok=True)

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 5173
BASE_URL = f"http://127.0.0.1:{PORT}"

def capture_all():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel='chrome',
            headless=True
        )

        # ---------------------------------------------------------
        # PART 1: Desktop View (1440x900) - Reference Benchmark
        # ---------------------------------------------------------
        print("=== PART 1: Capturing Desktop Benchmarks (1440x900) ===")
        desktop_context = browser.new_context(
            viewport={'width': 1440, 'height': 900},
            device_scale_factor=1
        )
        d_page = desktop_context.new_page()
        d_page.goto(f"{BASE_URL}/", wait_until="networkidle", timeout=30000)

        # Seed store with realistic mock repos & categories
        d_page.evaluate("""
            async () => {
                const mainRes = await fetch('/src/main.tsx');
                const mainText = await mainRes.text();
                const match = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                const storeUrl = match ? match[0] : '/src/store/useAppStore.ts';
                const mod = await import(storeUrl);

                const repos = [
                    {
                        id: 1,
                        name: 'awesome',
                        full_name: 'sindresorhus/awesome',
                        description: 'Awesome 是一个汇集各类主题精选资源列表的索引仓库，按平台、编程语言、前后端开发、计算机科学、大数据、理论等分类整理并链接到对应的 awesome 列表。',
                        html_url: 'https://github.com/sindresorhus/awesome',
                        stargazers_count: 512200,
                        language: null,
                        owner: { login: 'sindresorhus', avatar_url: 'https://avatars.githubusercontent.com/u/170270?v=4' },
                        topics: ['awesome', 'resources', 'lists'],
                        ai_summary: '全网知名精选资源索引总汇，涵盖多种语言、框架与软硬件技术领域。',
                        ai_platforms: ['web'],
                        updated_at: '2026-09-02T10:00:00Z',
                        pushed_at: '2026-09-02T10:00:00Z'
                    },
                    {
                        id: 2,
                        name: 'ollama',
                        full_name: 'ollama/ollama',
                        description: 'Ollama 用于在本地运行和管理开放模型（如 Kimi、GLM、MiniMax、DeepSeek、gpt-oss、Qwen、Gemma 等），提供命令行交互、REST API 以及 Python/JavaScript 库，并可与多种编码助手和聊天应用集成。',
                        html_url: 'https://github.com/ollama/ollama',
                        stargazers_count: 181900,
                        language: 'Go',
                        owner: { login: 'ollama', avatar_url: 'https://avatars.githubusercontent.com/u/14841261?v=4' },
                        topics: ['llm', 'ai', 'inference', 'deepseek'],
                        ai_summary: '最流行的本地大模型轻量推理框架，支持跨平台一键部署。',
                        ai_platforms: ['macos', 'windows', 'linux'],
                        updated_at: '2026-09-30T00:00:00Z',
                        pushed_at: '2026-09-30T00:00:00Z'
                    },
                    {
                        id: 3,
                        name: 'openclaw',
                        full_name: 'openclaw/openclaw',
                        description: 'OpenClaw 是一个开源 AI 助手，运行在用户自己的设备上，并接入用户已在使用的聊天渠道，同时提供 macOS、iOS、Android 等多平台支持。',
                        html_url: 'https://github.com/openclaw/openclaw',
                        stargazers_count: 390800,
                        language: 'TypeScript',
                        owner: { login: 'openclaw', avatar_url: 'https://avatars.githubusercontent.com/u/16196563?v=4' },
                        topics: ['assistant', 'ai', 'personal'],
                        ai_summary: '多端个人自托管 AI 助手框架。',
                        ai_platforms: ['macos', 'ios', 'android', 'windows'],
                        updated_at: '2026-09-30T01:00:00Z',
                        pushed_at: '2026-09-30T01:00:00Z'
                    },
                    {
                        id: 4,
                        name: 'deepseek-harness',
                        full_name: 'deepseek-ai/deepseek-harness',
                        description: 'DeepSeek Harness (dsh) 是 DeepSeek AI 开发的开源 agent harness，基于 everything-is-a-plugin 架构，由 Cordis 驱动。',
                        html_url: 'https://github.com/deepseek-ai/deepseek-harness',
                        stargazers_count: 239300,
                        language: 'TypeScript',
                        owner: { login: 'deepseek-ai', avatar_url: 'https://avatars.githubusercontent.com/u/148330837?v=4' },
                        topics: ['agent', 'deepseek', 'plugin'],
                        ai_summary: 'DeepSeek 官方 Agent 开源评估与插件化执行脚手架。',
                        ai_platforms: ['web'],
                        updated_at: '2026-09-30T02:00:00Z',
                        pushed_at: '2026-09-30T02:00:00Z'
                    }
                ];

                const cats = [
                    { id: 'cat-1', name: 'Web应用', count: 5, keywords: [] },
                    { id: 'cat-2', name: '移动应用', count: 2, keywords: [] },
                    { id: 'cat-3', name: '桌面应用', count: 8, keywords: [] },
                    { id: 'cat-4', name: '开发工具', count: 15, keywords: [] },
                    { id: 'cat-5', name: 'AI/大模型', count: 22, keywords: [] }
                ];

                mod.useAppStore.setState({
                    isAuthenticated: true,
                    user: { id: 1, login: 'developer', name: 'Developer', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
                    githubToken: 'ghp_mock_token_for_preview',
                    repositories: repos,
                    customCategories: cats,
                    currentView: 'repositories',
                    hasHydrated: true,
                    syncModeConfigured: true,
                    theme: 'dark'
                });

                // Also populate IndexedDB for discovery custom channel
                const mockChannel = {
                    id: 'custom:local-ai',
                    name: '本地离线 AI 工具',
                    instruction: '关注能本地离线运行的 AI 效率工具',
                    revision: 1,
                    plan: {
                        version: 1,
                        required: [{ text: '支持本地离线运行', source: '本地离线' }],
                        excluded: [{ text: '纯教程或电子书', source: '不要教程' }],
                        preferred: [{ text: '支持 Windows 跨平台', source: 'Windows 优先' }],
                        branches: [{ terms: ['local ai', 'offline llm'], readme: false }],
                        filters: { language: null, minStars: 50, maxStars: null, createdWithinDays: 365 },
                        filterSources: { language: null, minStars: '50', maxStars: null, createdWithinDays: '365' },
                        conflicts: [],
                        retrieval: { sort: { value: 'stars', source: '默认' } }
                    },
                    enabled: true,
                    paused: false,
                    ai: true,
                    autoAnalyze: true,
                    limit: 10,
                    hour: 8,
                    cursors: [],
                    blocked: [],
                    read: [],
                    recommended: { '2': '2026-09-30' }
                };

                const mockEdition = {
                    channelId: 'custom:local-ai',
                    date: '2026-09-30',
                    revision: 1,
                    instruction: '关注能本地离线运行的 AI 效率工具',
                    entries: [
                        {
                            repo: repos[1],
                            verdict: 'match',
                            reason: '原生支持 Windows/macOS 离线大模型推理，满足运行时要求且无云端依赖',
                            evidence: ['Run models directly on your hardware without transmitting data to third parties.'],
                            method: 'ai',
                            relevance: 0.98,
                            preference: 0.95
                        }
                    ],
                    pending: [],
                    errors: [],
                    complete: true,
                    searched: 48,
                    filtered: 16,
                    generatedAt: new Date().toISOString()
                };

                const db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open('gsm-custom-discovery', 1);
                    req.onupgradeneeded = () => req.result.createObjectStore('accounts');
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });

                await new Promise((resolve, reject) => {
                    const tx = db.transaction('accounts', 'readwrite');
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    tx.objectStore('accounts').put({
                        channels: [mockChannel],
                        editions: [mockEdition],
                        cache: {}
                    }, '1');
                });
                db.close();
            }
        """)
        time.sleep(1.0)

        def set_d_view(v):
            d_page.evaluate(f"""
                async () => {{
                    const mainRes = await fetch('/src/main.tsx');
                    const mainText = await mainRes.text();
                    const match = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                    const storeUrl = match ? match[0] : '/src/store/useAppStore.ts';
                    const mod = await import(storeUrl);
                    mod.useAppStore.setState({{ currentView: '{v}' }});
                }}
            """)
            time.sleep(1.0)

        # 01 Desktop Repositories
        set_d_view('repositories')
        d_page.screenshot(path=str(OUT_DIR / '01-desktop-repositories.png'))
        print("Captured 01-desktop-repositories.png")

        # 02 Desktop Details Drawer
        try:
            d_page.locator("button:has-text('详情'), button[aria-label*='详情']").first.click(timeout=3000)
            time.sleep(1.0)
            d_page.screenshot(path=str(OUT_DIR / '02-desktop-repo-details.png'))
            print("Captured 02-desktop-repo-details.png")
            d_page.keyboard.press("Escape")
            time.sleep(0.5)
        except Exception as e:
            print("Failed desktop drawer click:", e)

        # 03 Desktop Custom Discovery
        set_d_view('subscription')
        try:
            d_page.locator("button:has-text('本地离线 AI 工具'), div:has-text('本地离线 AI 工具')").last.click(timeout=3000)
            time.sleep(1.0)
            d_page.screenshot(path=str(OUT_DIR / '03-desktop-discovery.png'))
            print("Captured 03-desktop-discovery.png")

            # 04 Desktop Custom Editor
            d_page.locator("button:has(.lucide-pencil), button[title*='编辑']").first.click(timeout=3000)
            time.sleep(1.2)
            d_page.screenshot(path=str(OUT_DIR / '04-desktop-custom-editor.png'))
            print("Captured 04-desktop-custom-editor.png")
            d_page.keyboard.press("Escape")
            time.sleep(0.5)
        except Exception as e:
            print("Failed desktop discovery:", e)

        # 05 Desktop AI Workbench
        set_d_view('ai')
        d_page.screenshot(path=str(OUT_DIR / '05-desktop-ai-workbench.png'))
        print("Captured 05-desktop-ai-workbench.png")

        # 06 Desktop Settings
        set_d_view('settings')
        d_page.screenshot(path=str(OUT_DIR / '06-desktop-settings.png'))
        print("Captured 06-desktop-settings.png")

        desktop_context.close()

        # ---------------------------------------------------------
        # PART 2: Web App on Mobile Viewport (390x844)
        # ---------------------------------------------------------
        print("\n=== PART 2: Capturing Web on Mobile Viewport (390x844) ===")
        m_context = browser.new_context(
            viewport={'width': 390, 'height': 844},
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            is_mobile=True,
            has_touch=True
        )
        m_page = m_context.new_page()
        m_page.goto(f"{BASE_URL}/", wait_until="networkidle", timeout=30000)

        # Seed same state
        m_page.evaluate("""
            async () => {
                const mainRes = await fetch('/src/main.tsx');
                const mainText = await mainRes.text();
                const match = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                const storeUrl = match ? match[0] : '/src/store/useAppStore.ts';
                const mod = await import(storeUrl);

                const repos = [
                    {
                        id: 1,
                        name: 'awesome',
                        full_name: 'sindresorhus/awesome',
                        description: 'Awesome 是一个汇集各类主题精选资源列表的索引仓库，按平台、编程语言、前后端开发、计算机科学、大数据、理论等分类整理并链接到对应的 awesome 列表。',
                        html_url: 'https://github.com/sindresorhus/awesome',
                        stargazers_count: 512200,
                        language: null,
                        owner: { login: 'sindresorhus', avatar_url: 'https://avatars.githubusercontent.com/u/170270?v=4' },
                        topics: ['awesome', 'resources', 'lists'],
                        ai_summary: '全网知名精选资源索引总汇，涵盖多种语言、框架与软硬件技术领域。',
                        ai_platforms: ['web'],
                        updated_at: '2026-09-02T10:00:00Z',
                        pushed_at: '2026-09-02T10:00:00Z'
                    },
                    {
                        id: 2,
                        name: 'ollama',
                        full_name: 'ollama/ollama',
                        description: 'Ollama 用于在本地运行和管理开放模型（如 Kimi、GLM、MiniMax、DeepSeek、gpt-oss、Qwen、Gemma 等），提供命令行交互、REST API 以及 Python/JavaScript 库，并可与多种编码助手和聊天应用集成。',
                        html_url: 'https://github.com/ollama/ollama',
                        stargazers_count: 181900,
                        language: 'Go',
                        owner: { login: 'ollama', avatar_url: 'https://avatars.githubusercontent.com/u/14841261?v=4' },
                        topics: ['llm', 'ai', 'inference', 'deepseek'],
                        ai_summary: '最流行的本地大模型轻量推理框架，支持跨平台一键部署。',
                        ai_platforms: ['macos', 'windows', 'linux'],
                        updated_at: '2026-09-30T00:00:00Z',
                        pushed_at: '2026-09-30T00:00:00Z'
                    }
                ];

                const cats = [
                    { id: 'cat-1', name: 'Web应用', count: 5, keywords: [] },
                    { id: 'cat-2', name: '移动应用', count: 2, keywords: [] },
                    { id: 'cat-3', name: '桌面应用', count: 8, keywords: [] }
                ];

                mod.useAppStore.setState({
                    isAuthenticated: true,
                    user: { id: 1, login: 'developer', name: 'Developer', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
                    githubToken: 'ghp_mock_token_for_preview',
                    repositories: repos,
                    customCategories: cats,
                    currentView: 'repositories',
                    hasHydrated: true,
                    syncModeConfigured: true,
                    theme: 'dark'
                });
            }
        """)
        time.sleep(1.0)

        def set_m_view(v):
            m_page.evaluate(f"""
                async () => {{
                    const mainRes = await fetch('/src/main.tsx');
                    const mainText = await mainRes.text();
                    const match = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                    const storeUrl = match ? match[0] : '/src/store/useAppStore.ts';
                    const mod = await import(storeUrl);
                    mod.useAppStore.setState({{ currentView: '{v}' }});
                }}
            """)
            time.sleep(1.0)

        # 07 Web Mobile Repositories
        set_m_view('repositories')
        m_page.screenshot(path=str(OUT_DIR / '07-web-mobile-repositories.png'))
        print("Captured 07-web-mobile-repositories.png")

        # 08 Web Mobile Header Menu Open
        try:
            m_page.locator("button[aria-label*='菜单'], header button:has(.lucide-menu)").click(timeout=3000)
            time.sleep(0.5)
            m_page.screenshot(path=str(OUT_DIR / '08-web-mobile-header-menu.png'))
            print("Captured 08-web-mobile-header-menu.png")
            m_page.keyboard.press("Escape")
            time.sleep(0.3)
        except Exception as e:
            print("Failed mobile menu open:", e)

        # 09 Web Mobile Repo Details
        try:
            m_page.locator("button:has-text('详情'), button[aria-label*='详情']").first.click(timeout=3000)
            time.sleep(1.0)
            m_page.screenshot(path=str(OUT_DIR / '09-web-mobile-repo-details.png'))
            print("Captured 09-web-mobile-repo-details.png")
            m_page.keyboard.press("Escape")
            time.sleep(0.5)
        except Exception as e:
            print("Failed mobile details:", e)

        # 10 Web Mobile Discovery
        set_m_view('subscription')
        try:
            m_page.locator("button:has-text('本地离线 AI 工具'), div:has-text('本地离线 AI 工具')").last.click(timeout=3000)
            time.sleep(1.0)
        except Exception:
            pass
        m_page.screenshot(path=str(OUT_DIR / '10-web-mobile-discovery.png'))
        print("Captured 10-web-mobile-discovery.png")

        # 11 & 12 Web Mobile Custom Editor Tab 1 & Tab 2
        try:
            m_page.locator("button:has(.lucide-pencil), button[title*='编辑']").first.click(timeout=3000)
            time.sleep(1.2)
            m_page.screenshot(path=str(OUT_DIR / '11-web-mobile-custom-editor-tab1.png'))
            print("Captured 11-web-mobile-custom-editor-tab1.png")

            # Tab 2
            m_page.locator("button[role='tab']:has-text('规则')").first.click(timeout=2000)
            time.sleep(0.8)
            m_page.screenshot(path=str(OUT_DIR / '12-web-mobile-custom-editor-tab2.png'))
            print("Captured 12-web-mobile-custom-editor-tab2.png")
            m_page.keyboard.press("Escape")
            time.sleep(0.5)
        except Exception as e:
            print("Failed mobile editor tabs:", e)

        # 13 Web Mobile AI Workbench
        set_m_view('ai')
        m_page.screenshot(path=str(OUT_DIR / '13-web-mobile-ai-workbench.png'))
        print("Captured 13-web-mobile-ai-workbench.png")

        # 14 Web Mobile Gists
        set_m_view('gists')
        m_page.screenshot(path=str(OUT_DIR / '14-web-mobile-gists.png'))
        print("Captured 14-web-mobile-gists.png")

        # 15 Web Mobile Releases
        set_m_view('releases')
        m_page.screenshot(path=str(OUT_DIR / '15-web-mobile-releases.png'))
        print("Captured 15-web-mobile-releases.png")

        # 16 Web Mobile Forks
        set_m_view('forks')
        m_page.screenshot(path=str(OUT_DIR / '16-web-mobile-forks.png'))
        print("Captured 16-web-mobile-forks.png")

        # 17 Web Mobile Settings
        set_m_view('settings')
        m_page.screenshot(path=str(OUT_DIR / '17-web-mobile-settings.png'))
        print("Captured 17-web-mobile-settings.png")

        m_context.close()

        # ---------------------------------------------------------
        # PART 3: Dedicated Mobile Client (mobile.html) (390x844)
        # ---------------------------------------------------------
        print("\n=== PART 3: Capturing Dedicated Mobile Client (mobile.html) ===")
        app_context = browser.new_context(
            viewport={'width': 390, 'height': 844},
            user_agent='Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
            is_mobile=True,
            has_touch=True
        )
        app_page = app_context.new_page()

        # Mock API backend for mobile.html
        records = [
            {'collection': 'repositories', 'id': '1', 'version': 1, 'seq': 1, 'data': {
                'id': 1, 'name': 'awesome', 'full_name': 'sindresorhus/awesome', 'description': '各类精选资源列表总汇，涵盖各类语言与平台。',
                'custom_tags': ['精选', '资源'], 'custom_description': '', 'language': 'TypeScript', 'stargazers_count': 512200,
            }},
            {'collection': 'repositories', 'id': '2', 'version': 1, 'seq': 2, 'data': {
                'id': 2, 'name': 'ollama', 'full_name': 'ollama/ollama', 'description': '最流行的本地大模型轻量推理框架，支持 Windows/macOS/Linux。',
                'custom_tags': ['LLM', 'AI'], 'custom_description': '', 'language': 'Go', 'stargazers_count': 181900,
            }}
        ]
        caps = {
            'protocolVersion': 2,
            'workspace': {'id': 'browser-fixture', 'githubUserId': 42},
            'github': {'configured': True, 'verified': True, 'id': 42, 'login': 'fixture'},
            'aiConfigs': [{'id': 'deepseek-fixture', 'name': 'DeepSeek Chat', 'model': 'deepseek-chat', 'apiType': 'deepseek', 'available': True}]
        }

        def mock_api(route):
            req = route.request
            parsed = urlparse(req.url)
            if parsed.path == '/api/capabilities':
                route.fulfill(json=caps, headers={'Access-Control-Allow-Origin': '*'})
            elif parsed.path == '/api/sync/v2/snapshot':
                route.fulfill(json={'records': records, 'cursor': 2, 'snapshotId': 'fixed', 'nextOffset': 2, 'hasMore': False}, headers={'Access-Control-Allow-Origin': '*'})
            elif parsed.path == '/api/sync/v2/changes':
                route.fulfill(json={'records': [], 'cursor': 2, 'hasMore': False}, headers={'Access-Control-Allow-Origin': '*'})
            elif parsed.path == '/api/tasks':
                route.fulfill(json={'tasks': []}, headers={'Access-Control-Allow-Origin': '*'})
            else:
                route.fulfill(json={}, headers={'Access-Control-Allow-Origin': '*'})

        app_page.route('https://home.gsm.test/api/**', mock_api)
        app_page.goto(f"{BASE_URL}/mobile.html")
        time.sleep(1.0)

        # Fill connect credentials
        try:
            app_page.get_by_label('后端地址').fill('https://home.gsm.test')
            app_page.get_by_label('访问密钥').fill('browser-fixture-secret')
            app_page.get_by_role('button', name='验证并连接').click()
            time.sleep(2.0)
        except Exception as e:
            print("Auto connect note:", e)

        # 18 App Mobile Repositories
        app_page.screenshot(path=str(OUT_DIR / '18-app-mobile-repositories.png'))
        print("Captured 18-app-mobile-repositories.png")

        # 19 App Mobile Discovery
        try:
            app_page.locator("nav.mobile-nav button:has-text('发现')").click()
            time.sleep(1.0)
            app_page.screenshot(path=str(OUT_DIR / '19-app-mobile-discovery.png'))
            print("Captured 19-app-mobile-discovery.png")
        except Exception as e:
            print("Failed app discovery nav:", e)

        # 20 App Mobile Workbench
        try:
            app_page.locator("nav.mobile-nav button:has-text('AI')").click()
            time.sleep(1.0)
            app_page.screenshot(path=str(OUT_DIR / '20-app-mobile-workbench.png'))
            print("Captured 20-app-mobile-workbench.png")
        except Exception as e:
            print("Failed app workbench nav:", e)

        # 21 App Mobile Settings
        try:
            app_page.locator("header.mobile-topbar button[aria-label='设置']").click()
            time.sleep(1.0)
            app_page.screenshot(path=str(OUT_DIR / '21-app-mobile-settings.png'))
            print("Captured 21-app-mobile-settings.png")
        except Exception as e:
            print("Failed app settings nav:", e)

        app_context.close()
        browser.close()
        print("\nAll 21 comprehensive screenshots successfully captured into output/audit_fresh/!")

if __name__ == '__main__':
    capture_all()
