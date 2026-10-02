import os
import json
import time
from playwright.sync_api import sync_playwright

def main():
    os.makedirs('output/playwright', exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            headless=True
        )
        context = browser.new_context(viewport={'width': 1440, 'height': 960})
        page = context.new_page()

        print("Navigating to http://127.0.0.1:5174/...")
        page.goto("http://127.0.0.1:5174/", wait_until="networkidle", timeout=20000)

        # Set up authenticated state with backend repositories
        print("Configuring store state...")
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
                });
            }
        """)

        time.sleep(1.5)

        # 1. Overview screenshot
        print("Capturing 01-repo-overview.png...")
        page.screenshot(path='output/playwright/01-repo-overview.png')

        # 2. Filter panel screenshot
        print("Opening advanced filter panel...")
        filter_button = page.locator('button:has-text("过滤器"), button[title*="过滤"], button:has-text("Filter")').first
        if filter_button.is_visible():
            filter_button.click()
            time.sleep(0.8)
            print("Capturing 02-filter-panel.png...")
            page.screenshot(path='output/playwright/02-filter-panel.png')
            # Close filter panel
            filter_button.click()
            time.sleep(0.5)

        # 3. Card hover & micro-interactions
        print("Hovering on first repository card...")
        card = page.locator('.repository-card').first
        if card.is_visible():
            card.hover()
            time.sleep(0.8)
            print("Capturing 03-card-hover.png...")
            page.screenshot(path='output/playwright/03-card-hover.png')

        # 4. List view screenshot
        print("Switching to list view...")
        list_view_btn = page.locator('button:has-text("单列列表"), button[aria-label="单列列表"]').first
        if list_view_btn.is_visible():
            list_view_btn.click()
            page.locator('.repository-card--list').first.wait_for(timeout=5000)
            time.sleep(0.8)
            print("Capturing 04-list-view.png...")
            page.screenshot(path='output/playwright/04-list-view.png')

            # Switch back to grid view
            grid_view_btn = page.locator('button:has-text("多列卡片"), button[aria-label="多列卡片"]').first
            if grid_view_btn.is_visible():
                grid_view_btn.click()
                time.sleep(0.8)

        # 5. Details drawer screenshot
        print("Opening details drawer on first card...")
        first_card = page.locator('.repository-card').first
        if first_card.is_visible():
            # Click the explicit "详情" button or the card
            detail_trigger = first_card.locator('button:has-text("详情")').first
            if detail_trigger.is_visible():
                detail_trigger.click()
            else:
                first_card.click()

            page.locator('[role="dialog"], aside[aria-label*="详情"]').first.wait_for(timeout=5000)
            time.sleep(1.0)
            print("Capturing 05-details-drawer.png...")
            page.screenshot(path='output/playwright/05-details-drawer.png')

            # 6. Pinned workspace screenshot
            pin_btn = page.locator('button[title*="固定"], button[aria-label*="固定"]').first
            if pin_btn.is_visible():
                pin_btn.click()
                page.locator('aside[aria-label*="详情"]').wait_for(timeout=5000)
                time.sleep(1.0)
                print("Capturing 06-pinned-workspace.png...")
                page.screenshot(path='output/playwright/06-pinned-workspace.png')

                # Close drawer
                close_btn = page.locator('button[title*="关闭"], button[aria-label*="关闭"]').first
                if close_btn.is_visible():
                    close_btn.click()
                    time.sleep(0.5)

        # 7. Pending classification screenshot
        print("Navigating to Pending Classification...")
        pending_btn = page.locator('button:has-text("待分类")').first
        if pending_btn.is_visible():
            pending_btn.click()
            time.sleep(1.0)
            print("Capturing 07-pending-classification.png...")
            page.screenshot(path='output/playwright/07-pending-classification.png')

        browser.close()
        print("All verification screenshots successfully captured!")

if __name__ == '__main__':
    main()
