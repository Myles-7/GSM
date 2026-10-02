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

        # Populate state
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
                window.dispatchEvent(new CustomEvent('gsm:global-chat-history-changed'));
            }
        """)

        time.sleep(2.0)

        # Scroll center panel to top to show message bubbles
        page.evaluate("""
            () => {
                const scrollContainer = document.querySelector('main .overflow-y-auto');
                if (scrollContainer) scrollContainer.scrollTop = 0;
            }
        """)
        time.sleep(0.5)

        print("Capturing 10-ai-workbench-messages-scrolltop.png...")
        page.screenshot(path=os.path.join(out_dir, '10-ai-workbench-messages-scrolltop.png'))

        # Switch right tab to "已选仓库"
        page.locator('button[role="tab"]:has-text("已选仓库")').first.click()
        time.sleep(0.5)
        print("Capturing 11-ai-workbench-selected-tab.png...")
        page.screenshot(path=os.path.join(out_dir, '11-ai-workbench-selected-tab.png'))

        # Click on left sidebar dropdown "对话与项目"
        page.locator('aside select').first.select_option(value='archived')
        time.sleep(0.5)
        print("Capturing 12-ai-workbench-history-archived.png...")
        page.screenshot(path=os.path.join(out_dir, '12-ai-workbench-history-archived.png'))

        browser.close()
        print("Done capturing details!")

if __name__ == '__main__':
    main()
