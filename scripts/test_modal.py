from playwright.sync_api import sync_playwright
import time
import os

out_dir = 'output/audit_discovery'
os.makedirs(out_dir, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 960})
    page = context.new_page()
    page.goto('http://127.0.0.1:5174/')
    page.wait_for_timeout(2000)
    page.evaluate('''
        async () => {
            const mainRes = await fetch('/src/main.tsx');
            const mainText = await mainRes.text();
            const appMatch = mainText.match(/\\/src\\/store\\/useAppStore\\.ts(\\?t=\\d+)?/);
            const appStoreMod = await import(appMatch ? appMatch[0] : '/src/store/useAppStore.ts');

            appStoreMod.useAppStore.setState({
                isAuthenticated: true,
                user: { id: 1, login: 'developer', name: 'Developer', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
                githubToken: 'ghp_mock_token_for_preview',
                currentView: 'subscription',
                hasHydrated: true,
                syncModeConfigured: true,
                theme: 'dark'
            });
        }
    ''')
    time.sleep(1.0)
    
    # Click the visible + button
    plus_btn = page.locator('button[title*="新建自定义频道"]:visible, button[aria-label*="新建自定义频道"]:visible').first
    plus_btn.click()
    time.sleep(1.0)
    page.screenshot(path=os.path.join(out_dir, '04-custom-editor-empty.png'))
    print("Captured 04-custom-editor-empty.png")

    # Select template 2 (本地 AI)
    select_template = page.locator('[role="dialog"] select').first
    select_template.select_option(value='2')
    time.sleep(1.0)
    page.screenshot(path=os.path.join(out_dir, '05-custom-editor-template-selected.png'))
    print("Captured 05-custom-editor-template-selected.png")

    # Click "解析需求" (Parse request) button
    parse_btn = page.locator('[role="dialog"] button:has-text("解析需求")').first
    if parse_btn.is_visible():
        parse_btn.click()
        print("Clicked parse request...")
        time.sleep(3.0)
        page.screenshot(path=os.path.join(out_dir, '06-custom-editor-parsed.png'))
        print("Captured 06-custom-editor-parsed.png")

    # Expand "进阶筛选" (Advanced filters)
    details = page.locator('[role="dialog"] details summary').first
    if details.is_visible():
        details.click()
        time.sleep(0.5)
        page.screenshot(path=os.path.join(out_dir, '06b-custom-editor-advanced-filters.png'))
        print("Captured 06b-custom-editor-advanced-filters.png")

    # Click "保存频道" to see if it saves and appears in the sidebar!
    save_btn = page.locator('[role="dialog"] button:has-text("保存频道")').first
    if save_btn.is_enabled():
        save_btn.click()
        print("Clicked save channel...")
        time.sleep(2.0)
        page.screenshot(path=os.path.join(out_dir, '07-after-save-channel.png'))
        print("Captured 07-after-save-channel.png")

        # Now click on the newly created channel in the sidebar!
        channel_btn = page.locator('button:has-text("本地 AI"), button:has-text("自定义")').first
        if channel_btn.is_visible():
            channel_btn.click()
            time.sleep(1.5)
            page.screenshot(path=os.path.join(out_dir, '08-custom-channel-view-active.png'))
            print("Captured 08-custom-channel-view-active.png")

    browser.close()
    print("Done test_modal!")
