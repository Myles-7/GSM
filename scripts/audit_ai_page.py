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

        print("Navigating to http://127.0.0.1:5174/...")
        page.goto("http://127.0.0.1:5174/", wait_until="networkidle", timeout=20000)

        # Populate state with backend data and switch to 'ai' view
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
                    repos = Array.isArray(data.repositories) ? data.repositories : (Array.isArray(data) ? data : []);
                }

                const catRes = await fetch('http://127.0.0.1:3000/api/categories');
                let cats = [];
                if (catRes.ok) {
                    const catData = await catRes.json();
                    cats = Array.isArray(catData.categories) ? catData.categories : (Array.isArray(catData) ? catData : []);
                }

                mod.useAppStore.setState({
                    isAuthenticated: true,
                    user: { id: 1, login: 'developer', name: 'Developer', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
                    githubToken: 'ghp_mock_token_for_preview',
                    repositories: repos,
                    customCategories: cats,
                    currentView: 'ai',
                    hasHydrated: true,
                    syncModeConfigured: true,
                    theme: 'dark'
                });
            }
        """)

        time.sleep(1.2)

        # 1. Dark theme default AI workbench
        print("Capturing 01-ai-workbench-default.png...")
        page.screenshot(path=os.path.join(out_dir, '01-ai-workbench-default.png'))

        # 2. Light theme AI workbench
        print("Switching to light theme...")
        page.evaluate("""
            async () => {
                const mainRes = await fetch('/src/main.tsx');
                const mainText = await mainRes.text();
                const match = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                const storeUrl = match ? match[0] : '/src/store/useAppStore.ts';
                const mod = await import(storeUrl);
                mod.useAppStore.setState({ theme: 'light' });
            }
        """)
        time.sleep(0.5)
        print("Capturing 02-ai-workbench-light.png...")
        page.screenshot(path=os.path.join(out_dir, '02-ai-workbench-light.png'))

        # Switch back to dark theme
        page.evaluate("""
            async () => {
                const mainRes = await fetch('/src/main.tsx');
                const mainText = await mainRes.text();
                const match = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                const storeUrl = match ? match[0] : '/src/store/useAppStore.ts';
                const mod = await import(storeUrl);
                mod.useAppStore.setState({ theme: 'dark' });
            }
        """)
        time.sleep(0.5)

        # 3. Click Right panel toggle (PanelRight) to show candidate repositories
        print("Toggling right panel...")
        right_panel_btn = page.locator('button[title*="仓库"], button[aria-label*="仓库"]').first
        if right_panel_btn.is_visible():
            right_panel_btn.click()
            time.sleep(0.6)
            print("Capturing 03-ai-workbench-right-open.png...")
            page.screenshot(path=os.path.join(out_dir, '03-ai-workbench-right-open.png'))

        # 4. Trigger AI Organization Dialog from Repositories page
        print("Switching to repositories view to test AI Organization modal...")
        page.evaluate("""
            async () => {
                const mainRes = await fetch('/src/main.tsx');
                const mainText = await mainRes.text();
                const match = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                const storeUrl = match ? match[0] : '/src/store/useAppStore.ts';
                const mod = await import(storeUrl);
                mod.useAppStore.setState({ currentView: 'repositories' });
            }
        """)
        time.sleep(0.8)
        ai_org_btn = page.locator('button:has-text("AI 整理"), button[title*="AI 整理"]').first
        if ai_org_btn.is_visible():
            ai_org_btn.click()
            time.sleep(1.0)
            print("Capturing 04-ai-organization-modal.png...")
            page.screenshot(path=os.path.join(out_dir, '04-ai-organization-modal.png'))
            # close dialog if open
            page.keyboard.press("Escape")
            time.sleep(0.5)

        # 5. Switch back to AI view and test Mobile viewport (390x844)
        print("Testing mobile viewport on AI workbench...")
        page.evaluate("""
            async () => {
                const mainRes = await fetch('/src/main.tsx');
                const mainText = await mainRes.text();
                const match = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
                const storeUrl = match ? match[0] : '/src/store/useAppStore.ts';
                const mod = await import(storeUrl);
                mod.useAppStore.setState({ currentView: 'ai' });
            }
        """)
        time.sleep(0.5)
        page.set_viewport_size({'width': 390, 'height': 844})
        time.sleep(0.8)
        print("Capturing 05-ai-workbench-mobile.png...")
        page.screenshot(path=os.path.join(out_dir, '05-ai-workbench-mobile.png'))

        # Open mobile left history sheet
        history_btn = page.locator('button[aria-label*="历史"], button[aria-label*="history"]').first
        if history_btn.is_visible():
            history_btn.click()
            time.sleep(0.6)
            print("Capturing 06-ai-workbench-mobile-history.png...")
            page.screenshot(path=os.path.join(out_dir, '06-ai-workbench-mobile-history.png'))
            page.keyboard.press("Escape")
            time.sleep(0.4)

        # 6. Tablet viewport (768x1024)
        print("Testing tablet viewport...")
        page.set_viewport_size({'width': 768, 'height': 1024})
        time.sleep(0.8)
        print("Capturing 07-ai-workbench-tablet.png...")
        page.screenshot(path=os.path.join(out_dir, '07-ai-workbench-tablet.png'))

        browser.close()
        print("All AI page audit screenshots captured successfully!")

if __name__ == '__main__':
    main()
