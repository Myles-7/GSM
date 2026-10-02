import os
import time
from playwright.sync_api import sync_playwright

def main():
    out_dir = 'output/audit_discovery'
    os.makedirs(out_dir, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            headless=True
        )
        context = browser.new_context(viewport={'width': 1440, 'height': 960})
        page = context.new_page()

        page.goto("http://127.0.0.1:5174/", wait_until="networkidle", timeout=20000)

        page.evaluate("""
            async () => {
                const mainRes = await fetch('/src/main.tsx');
                const mainText = await mainRes.text();
                const appMatch = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                const appStoreMod = await import(appMatch ? appMatch[0] : '/src/store/useAppStore.ts');

                const res = await fetch('http://127.0.0.1:3000/api/repositories');
                let repos = [];
                if (res.ok) {
                    const data = await res.json();
                    repos = Array.isArray(data.repositories) ? data.repositories : [];
                }

                appStoreMod.useAppStore.setState({
                    isAuthenticated: true,
                    user: { id: 1, login: 'developer', name: 'Developer', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
                    githubToken: 'ghp_mock_token_for_preview',
                    repositories: repos,
                    currentView: 'subscription',
                    hasHydrated: true,
                    syncModeConfigured: true,
                    theme: 'dark'
                });

                const discRes = await fetch('/src/components/DiscoveryView.tsx');
                const discText = await discRes.text();
                const storeMatch = discText.match(/\\/src\\/features\\/discovery\\/custom\\/store\\.ts(\\?t=\\d+)?/);
                const storeMod = await import(storeMatch ? storeMatch[0] : '/src/features/discovery/custom/store.ts');

                const mockChannel = {
                    id: 'custom:local-ai-tools',
                    name: '本地离线 AI 与大模型工具',
                    instruction: '关注能本地离线运行的 AI 效率工具与大模型运行时，Windows/macOS 优先，不要教程和静态资源合集',
                    revision: 1,
                    plan: {
                        version: 1,
                        required: [
                            { text: '支持本地离线运行', source: '本地离线运行' },
                            { text: '具备可执行能力或完整运行时', source: '效率工具与运行时' }
                        ],
                        excluded: [
                            { text: '纯教程或电子书', source: '不要教程' },
                            { text: '资源导航与 Awesome 列表合集', source: '静态资源合集' }
                        ],
                        preferred: [
                            { text: '支持 Windows/macOS 跨平台', source: 'Windows/macOS 优先' }
                        ],
                        branches: [
                            { terms: ['local llm', 'offline ai'], readme: false },
                            { terms: ['model runner', 'inference engine'], readme: false }
                        ],
                        filters: {
                            language: null,
                            minStars: 100,
                            maxStars: null,
                            createdWithinDays: 365
                        },
                        filterSources: {
                            language: null,
                            minStars: '100',
                            maxStars: null,
                            createdWithinDays: '365'
                        },
                        conflicts: [],
                        retrieval: {
                            sort: { value: 'stars', source: '默认' },
                            scope: { value: 'all', source: '默认' },
                            excludeArchived: { value: true, source: '默认' },
                            excludeForks: { value: true, source: '默认' },
                            excludeStarred: { value: false, source: '默认' },
                            excludeRecommended: { value: true, source: '默认' }
                        }
                    },
                    ruleOverrides: {
                        minStars: 100,
                        createdWithinDays: 365,
                        sort: 'stars'
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
                    recommended: {},
                    lastRefresh: new Date().toISOString()
                };

                const mockEdition = {
                    channelId: 'custom:local-ai-tools',
                    date: '2026-09-29',
                    revision: 1,
                    instruction: mockChannel.instruction,
                    entries: [
                        {
                            repo: {
                                id: 991,
                                name: 'ollama',
                                full_name: 'ollama/ollama',
                                description: 'Get up and running with Llama 3.3, DeepSeek-R1, Mistral, and other large language models.',
                                html_url: 'https://github.com/ollama/ollama',
                                stargazers_count: 112500,
                                forks_count: 9800,
                                forks: 9800,
                                language: 'Go',
                                created_at: '2023-07-01T00:00:00Z',
                                updated_at: '2026-09-28T00:00:00Z',
                                pushed_at: '2026-09-28T12:00:00Z',
                                owner: { login: 'ollama', avatar_url: 'https://avatars.githubusercontent.com/u/130182813?v=4' },
                                topics: ['llm', 'ai', 'llama', 'local-llm', 'inference'],
                                ai_summary: '目前最流行的轻量跨平台本地模型运行框架，支持 macOS、Windows、Linux 一键拉取与运行主流开源模型，内置兼容 OpenAI 的 REST API。',
                                ai_platforms: ['windows', 'macos', 'linux']
                            },
                            verdict: 'match',
                            reason: '原生支持 Windows/macOS 离线大模型推理，满足运行时要求且无云端依赖',
                            evidence: [
                                'Get up and running with Llama 3, Mistral, and other large language models locally.',
                                'Run models directly on your hardware without transmitting data to third parties.'
                            ],
                            method: 'ai',
                            relevance: 0.98,
                            preference: 0.95
                        },
                        {
                            repo: {
                                id: 992,
                                name: 'LocalAI',
                                full_name: 'mudler/LocalAI',
                                description: 'The free, Open Source alternative to OpenAI, Claude and more. Self-hosted and local-first.',
                                html_url: 'https://github.com/mudler/LocalAI',
                                stargazers_count: 28400,
                                forks_count: 2400,
                                forks: 2400,
                                language: 'Go',
                                created_at: '2023-03-01T00:00:00Z',
                                updated_at: '2026-09-27T00:00:00Z',
                                pushed_at: '2026-09-27T08:00:00Z',
                                owner: { login: 'mudler', avatar_url: 'https://avatars.githubusercontent.com/u/514415?v=4' },
                                topics: ['localai', 'ai', 'offline', 'rest-api'],
                                ai_summary: '针对生产环境自托管的本地多模态 AI 网关，完全兼容 OpenAI API 规范，支持音频转写、图片生成和 LLM 推理。',
                                ai_platforms: ['linux', 'windows', 'macos']
                            },
                            verdict: 'match',
                            reason: '自托管本地多模态 AI 引擎，提供无外部依赖的纯本地运行体验',
                            evidence: [
                                'Free, Open Source alternative to OpenAI, Claude, Whisper, Stable Diffusion, self-hosted and local-first.'
                            ],
                            method: 'ai',
                            relevance: 0.94,
                            preference: 0.88
                        }
                    ],
                    pending: [
                        {
                            repo: {
                                id: 993,
                                name: 'awesome-local-ai',
                                full_name: 'example/awesome-local-ai',
                                description: 'A curated list of local AI tools, models and resources.',
                                html_url: 'https://github.com/example/awesome-local-ai',
                                stargazers_count: 4200,
                                forks_count: 320,
                                forks: 320,
                                language: 'Markdown',
                                created_at: '2024-01-01T00:00:00Z',
                                updated_at: '2026-09-20T00:00:00Z',
                                pushed_at: '2026-09-20T00:00:00Z',
                                owner: { login: 'example', avatar_url: 'https://avatars.githubusercontent.com/u/99?v=4' },
                                topics: ['awesome', 'local-ai'],
                                ai_summary: '本地 AI 资源清单与工具合集。'
                            },
                            verdict: 'unknown',
                            reason: '疑似为静态资源合集（Awesome List），待进一步语义核实是否符合排除条件',
                            evidence: ['A curated list of local AI tools and resources'],
                            method: 'rules',
                            relevance: 0.65,
                            preference: 0.1
                        }
                    ],
                    errors: [],
                    complete: true,
                    searched: 48,
                    filtered: 16,
                    generatedAt: new Date().toISOString()
                };

                storeMod.useCustomDiscovery.setState({
                    account: '1',
                    data: {
                        channels: [mockChannel],
                        editions: [mockEdition],
                        cache: {}
                    },
                    selected: 'custom:local-ai-tools'
                });
            }
        """)

        time.sleep(1.5)

        # 08: Capture CustomChannelView active
        print("Capturing 08-custom-channel-view.png...")
        page.screenshot(path=os.path.join(out_dir, '08-custom-channel-view.png'))

        # 09: Capture CustomChannelView in Light mode
        page.evaluate("() => document.documentElement.classList.remove('dark')")
        time.sleep(0.5)
        print("Capturing 09-custom-channel-view-light.png...")
        page.screenshot(path=os.path.join(out_dir, '09-custom-channel-view-light.png'))
        page.evaluate("() => document.documentElement.classList.add('dark')")
        time.sleep(0.5)

        # 10: Click on "待核实" tab
        page.evaluate("""
            () => {
                const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
                const unverifiedTab = tabs.find(b => b.textContent && b.textContent.includes('待核实'));
                if (unverifiedTab) unverifiedTab.click();
            }
        """)
        time.sleep(0.5)
        print("Capturing 10-custom-channel-unverified.png...")
        page.screenshot(path=os.path.join(out_dir, '10-custom-channel-unverified.png'))

        # Switch back to "推荐"
        page.evaluate("""
            () => {
                const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
                const recTab = tabs.find(b => b.textContent && b.textContent.includes('推荐'));
                if (recTab) recTab.click();
            }
        """)
        time.sleep(0.5)

        # 11: Click edit button to open CustomChannelEditor with full channel rules loaded!
        page.evaluate("""
            () => {
                const editBtn = document.querySelector('header.ui-toolbar button[title="编辑"], header.ui-toolbar button[aria-label="编辑"]');
                if (editBtn) editBtn.click();
            }
        """)
        time.sleep(1.0)
        print("Capturing 11-custom-editor-edit-mode.png...")
        page.screenshot(path=os.path.join(out_dir, '11-custom-editor-edit-mode.png'))

        # 12: Expand "进阶筛选" in CustomChannelEditor
        page.evaluate("""
            () => {
                const summary = document.querySelector('[role="dialog"] details summary');
                if (summary) summary.click();
            }
        """)
        time.sleep(0.5)
        print("Capturing 12-custom-editor-advanced.png...")
        page.screenshot(path=os.path.join(out_dir, '12-custom-editor-advanced.png'))

        browser.close()
        print("Done capturing full custom discovery audit!")

if __name__ == '__main__':
    main()
