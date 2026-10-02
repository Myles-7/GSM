import os
import time
from playwright.sync_api import sync_playwright

def main():
    out_dir = 'output/audit'
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

        # Populate state with backend data
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
                    currentView: 'repositories',
                    hasHydrated: true,
                    syncModeConfigured: true,
                    theme: 'dark'
                });
            }
        """)

        time.sleep(1.0)

        # 1. Dark theme main grid view
        print("Capturing 01-dark-grid-view.png...")
        page.screenshot(path=os.path.join(out_dir, '01-dark-grid-view.png'))

        # 2. Light theme main grid view
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
        print("Capturing 02-light-grid-view.png...")
        page.screenshot(path=os.path.join(out_dir, '02-light-grid-view.png'))

        # Switch back to dark for consistency
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

        # 3. Card Action Menu Open
        print("Opening card action menu...")
        first_card = page.locator('.repository-card').first
        more_btn = first_card.locator('button[aria-label*="更多"], button[title*="更多"]').first
        if more_btn.is_visible():
            more_btn.click()
            time.sleep(0.5)
            print("Capturing 03-card-action-menu.png...")
            page.screenshot(path=os.path.join(out_dir, '03-card-action-menu.png'))
            page.keyboard.press("Escape")
            time.sleep(0.3)

        # 4. Search input with active typing & suggestions
        print("Interacting with Search input...")
        search_input = page.locator('input[placeholder*="搜索"], input[aria-label*="搜索"]').first
        if search_input.is_visible():
            search_input.fill("AI")
            time.sleep(0.8)
            print("Capturing 04-search-active.png...")
            page.screenshot(path=os.path.join(out_dir, '04-search-active.png'))
            search_input.fill("")
            time.sleep(0.5)

        # 5. Search empty results state
        print("Triggering search empty state...")
        if search_input.is_visible():
            search_input.fill("xyz123nonexistentkeyword")
            time.sleep(0.8)
            print("Capturing 05-search-empty-state.png...")
            page.screenshot(path=os.path.join(out_dir, '05-search-empty-state.png'))
            search_input.fill("")
            time.sleep(0.5)

        # 6. Details Drawer - Usage & Deployment tab
        print("Opening details drawer for usage tab...")
        ollama_card = page.locator('.repository-card:has-text("ollama")').first
        if ollama_card.is_visible():
            ollama_card.click()
            time.sleep(0.8)
            usage_tab = page.locator('button[role="tab"]:has-text("使用与部署")')
            if usage_tab.is_visible():
                usage_tab.click()
                time.sleep(0.5)
                print("Capturing 06-details-usage-tab.png...")
                page.screenshot(path=os.path.join(out_dir, '06-details-usage-tab.png'))

            # 7. Details Drawer - Maintenance tab
            maint_tab = page.locator('button[role="tab"]:has-text("维护")')
            if maint_tab.is_visible():
                maint_tab.click()
                time.sleep(0.5)
                print("Capturing 07-details-maintenance-tab.png...")
                page.screenshot(path=os.path.join(out_dir, '07-details-maintenance-tab.png'))

            # Close drawer
            close_btn = page.locator('button[title*="关闭"], button[aria-label*="关闭"]').first
            if close_btn.is_visible():
                close_btn.click()
                time.sleep(0.5)

        # 8. Mobile viewport responsive layout (390x844)
        print("Testing mobile viewport (390x844)...")
        page.set_viewport_size({'width': 390, 'height': 844})
        time.sleep(0.8)
        print("Capturing 08-mobile-view.png...")
        page.screenshot(path=os.path.join(out_dir, '08-mobile-view.png'))

        # 9. Tablet viewport responsive layout (768x1024)
        print("Testing tablet viewport (768x1024)...")
        page.set_viewport_size({'width': 768, 'height': 1024})
        time.sleep(0.8)
        print("Capturing 09-tablet-view.png...")
        page.screenshot(path=os.path.join(out_dir, '09-tablet-view.png'))

        browser.close()
        print("All audit screenshots captured successfully!")

if __name__ == '__main__':
    main()
