import os
import time
from playwright.sync_api import sync_playwright

def main():
    out_dir = 'output/audit_ai'
    os.makedirs(out_dir, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            headless=True
        )
        context = browser.new_context(viewport={'width': 1440, 'height': 960})
        page = context.new_page()

        page.goto("http://127.0.0.1:5174/", wait_until="networkidle", timeout=20000)

        # Populate state with backend data and inject sample conversation in AI Workbench
        page.evaluate("""
            async () => {
                const mainRes = await fetch('/src/main.tsx');
                const mainText = await mainRes.text();
                const match = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                const storeUrl = match ? match[0] : '/src/store/useAppStore.ts';
                const mod = await import(storeUrl);

                const res = await fetch('http://127.0.0.1:3000/api/repositories');
                let repos = [];
                if (res.ok) {
                    const data = await res.json();
                    repos = Array.isArray(data.repositories) ? data.repositories : [];
                }

                mod.useAppStore.setState({
                    isAuthenticated: true,
                    user: { id: 1, login: 'developer', name: 'Developer', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
                    githubToken: 'ghp_mock_token_for_preview',
                    repositories: repos,
                    currentView: 'ai',
                    hasHydrated: true,
                    syncModeConfigured: true,
                    theme: 'dark'
                });

                const sessionId = 'test-session-1';
                sessionStorage.setItem('gsm:ai-workbench-session', sessionId);

                const storageMod = await import('/src/services/repositoryChatStorage.ts');
                const targetRepo = repos[0] || {
                    id: 12345,
                    name: 'ollama',
                    full_name: 'ollama/ollama',
                    description: 'Get up and running with Llama 3, Mistral, Gemma, and other large language models.',
                    html_url: 'https://github.com/ollama/ollama',
                    stargazers_count: 98000,
                    forks_count: 8500,
                    forks: 8500,
                    language: 'Go',
                    created_at: '2023-07-01T00:00:00Z',
                    updated_at: '2026-03-01T00:00:00Z',
                    pushed_at: '2026-03-01T00:00:00Z',
                    owner: { login: 'ollama', avatar_url: 'https://avatars.githubusercontent.com/u/130182813?v=4' },
                    topics: ['llm', 'ai', 'llama', 'local-llm']
                };

                const secondRepo = repos[1] || targetRepo;

                await storageMod.repositoryChatStorage.saveSession({
                    id: sessionId,
                    repoId: 0,
                    repoFullName: 'Global AI Workbench',
                    sourceRefSha: 'main',
                    title: '寻找本地运行的开源大模型工具',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    pinned: false,
                    archived: false,
                    kind: 'workbench',
                    ownerId: '1',
                    workbench: {
                        scope: 'github',
                        depth: 'standard',
                        requirements: {
                            purpose: '寻找本地离线大模型运行工具',
                            required: ['支持本地离线运行', '开箱即用无需复杂编译'],
                            excluded: ['纯云端商业服务API'],
                            preferred: ['支持 REST API', '支持 WebUI 扩展'],
                            questions: ['需要支持 GPU 加速还是仅 CPU 推理？'],
                            queries: ['local llm runner', 'offline llm api']
                        },
                        searchBatches: [
                            {
                                id: 'batch-1',
                                createdAt: new Date().toISOString(),
                                nextPage: 2,
                                queries: ['local llm runner', 'offline model engine'],
                                requirements: {
                                    purpose: '寻找本地离线大模型运行工具',
                                    required: ['支持本地离线运行'],
                                    excluded: [],
                                    preferred: [],
                                    questions: [],
                                    queries: []
                                },
                                candidates: [
                                    {
                                        repository: targetRepo,
                                        summary: '目前最流行的跨平台本地模型运行框架，支持 macOS、Windows、Linux，提供类 Docker 的命令行交互与兼容 OpenAI 的 REST API。',
                                        reasons: ['全平台一键安装包支持', '内置丰富模型库拉取', '兼容 OpenAI API 规范'],
                                        limitations: ['默认模型权重大需预留磁盘空间'],
                                        sources: ['https://github.com/ollama/ollama'],
                                        status: 'verified'
                                    },
                                    {
                                        repository: secondRepo,
                                        summary: '专注于全功能客户端与生态接入的自主大模型框架。',
                                        reasons: ['支持多端设备与本地运行', '扩展插件生态丰富'],
                                        limitations: ['配置选项较多初学者门槛偏高'],
                                        sources: ['https://github.com/' + secondRepo.full_name],
                                        status: 'candidate'
                                    }
                                ]
                            }
                        ],
                        selectedRepositories: [targetRepo]
                    }
                });

                await storageMod.repositoryChatStorage.saveMessage({
                    id: 'msg-1',
                    sessionId,
                    role: 'user',
                    content: '我想找一些可以在 Windows 和 macOS 本地离线运行的开源大模型工具，最好支持一键启动和兼容 OpenAI 的 REST API。',
                    createdAt: new Date(Date.now() - 60000).toISOString(),
                    evidenceIds: [],
                    status: 'complete'
                });

                await storageMod.repositoryChatStorage.saveMessage({
                    id: 'msg-2',
                    sessionId,
                    role: 'assistant',
                    content: '为您检索并分析了以下最匹配的本地开源模型运行工具：\\n\\n### 1. [Ollama](https://github.com/ollama/ollama) ⭐ 98k+\\n- **核心亮点**：提供类似 Docker 的一键运行体验（`ollama run llama3`），自带兼容 OpenAI 协议的本地 HTTP 服务。\\n- **跨平台**：macOS、Windows (含 WSL2 与原生版)、Linux 均有良好支持。\\n\\n### 2. [LocalAI](https://github.com/mudler/LocalAI) ⭐ 25k+\\n- **核心亮点**：用 Go/C++ 打造的 OpenAI 替代方案，支持文本、生图、声音全模态。\\n\\n已在右侧为您整理了候选清单与操作提案，您可以点击勾选将其加入星标仓库管理。',
                    createdAt: new Date().toISOString(),
                    evidenceIds: [],
                    status: 'complete'
                });

                await storageMod.repositoryChatStorage.saveProposal({
                    id: 'prop-1',
                    ownerId: '1',
                    sessionId,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    operations: [
                        {
                            id: 'op-1',
                            repository: targetRepo,
                            kind: 'update',
                            reason: '根据本次检索结果，自动标记为「AI / 本地大模型」',
                            before: {
                                custom_category: targetRepo.custom_category || null,
                                category_locked: Boolean(targetRepo.category_locked),
                                custom_tags: targetRepo.custom_tags || [],
                                custom_description: targetRepo.custom_description || null
                            },
                            after: {
                                custom_category: 'AI / 本地大模型',
                                category_locked: false,
                                custom_tags: ['Local LLM', 'Offline', 'OpenAI-API'],
                                custom_description: '本地离线大模型运行工具，支持一键拉取模型与 REST API'
                            },
                            selected: true,
                            overrideLocked: false,
                            status: 'proposed'
                        }
                    ]
                });

                window.dispatchEvent(new CustomEvent('gsm:global-chat-history-changed'));
            }
        """)

        time.sleep(2.0)

        # 1. Scrolled to top of messages
        page.evaluate("""
            () => {
                const scrollEl = document.querySelector('main .overflow-y-auto');
                if (scrollEl) scrollEl.scrollTop = 0;
            }
        """)
        time.sleep(0.5)
        print("Capturing 08b-ai-workbench-chat-messages.png...")
        page.screenshot(path=os.path.join(out_dir, '08b-ai-workbench-chat-messages.png'))

        # 2. Switch right tab to "已选仓库"
        page.evaluate("""
            () => {
                const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
                if (tabs[1]) tabs[1].click();
            }
        """)
        time.sleep(0.5)
        print("Capturing 11-ai-workbench-selected-tab.png...")
        page.screenshot(path=os.path.join(out_dir, '11-ai-workbench-selected-tab.png'))

        # 3. Open project dialog
        page.evaluate("""
            () => {
                const addFolderBtn = document.querySelector('aside button[title*="项目"], aside button svg.lucide-folder-plus');
                if (addFolderBtn) {
                    const btn = addFolderBtn.closest('button');
                    if (btn) btn.click();
                }
            }
        """)
        time.sleep(0.5)
        print("Capturing 12-ai-workbench-project-modal.png...")
        page.screenshot(path=os.path.join(out_dir, '12-ai-workbench-project-modal.png'))

        browser.close()
        print("Done!")

if __name__ == '__main__':
    main()
