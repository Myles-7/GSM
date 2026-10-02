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

        # Switch to AI view and setup store
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
            }
        """)

        time.sleep(1.5)

        # Find and click the session button
        res = page.evaluate("""
            () => {
                const btns = Array.from(document.querySelectorAll('aside button'));
                const sessionBtn = btns.find(b => b.textContent && b.textContent.includes('寻找本地运行'));
                if (sessionBtn) {
                    sessionBtn.click();
                    return { clicked: true, text: sessionBtn.textContent };
                }
                return { clicked: false, buttons: btns.map(b => b.textContent) };
            }
        """)
        print("Select session:", res)

        time.sleep(1.5)

        # Scroll to top of main area
        page.evaluate("""
            () => {
                const scrollEl = document.querySelector('main .overflow-y-auto');
                if (scrollEl) scrollEl.scrollTop = 0;
            }
        """)
        time.sleep(0.5)

        page.screenshot(path=os.path.join(out_dir, '13-chat-messages-view.png'))
        print("Captured 13-chat-messages-view.png")

        browser.close()

if __name__ == '__main__':
    main()
