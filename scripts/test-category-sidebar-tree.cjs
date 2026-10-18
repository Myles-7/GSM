const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.GSM_PLAYWRIGHT_MODULE);

async function run() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === 'http://127.0.0.1:5207' && !url.pathname.startsWith('/api') ? route.continue() : route.abort();
    });
    await page.goto('http://127.0.0.1:5207');
    await page.waitForFunction(async () => (await import('/src/store/useAppStore.ts')).useAppStore.persist.hasHydrated());
    await page.waitForFunction(() => performance.getEntriesByName('gsm:backend-initialize-finished').length > 0);
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/store/useAppStore.ts');
      const date = '2026-10-07T00:00:00.000Z';
      const categories = [{ id: 'science', name: 'Scientific Research and Numerical Computing', icon: 'folder', keywords: [], isCustom: true },
        { id: 'tools', name: 'Developer Tools', icon: 'folder', keywords: [], isCustom: true }];
      const repositories = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `project-${i + 1}`, full_name: `fixture/project-${i + 1}`,
        html_url: `https://github.com/fixture/project-${i + 1}`, description: 'A scientific computing library for numerical analysis.',
        language: 'Python', owner: { login: 'fixture', avatar_url: '' }, topics: ['science'], stargazers_count: 10, forks: 0, forks_count: 0,
        created_at: date, updated_at: date, pushed_at: date, category_id: 'science', subcategory_id: i < 7 ? 'numeric' : 'data' }));
      useAppStore.setState({ user: { id: 42, login: 'fixture', avatar_url: '', html_url: 'https://github.com/fixture' }, isAuthenticated: true,
        repositories, searchResults: repositories, customCategories: categories, hiddenDefaultCategoryIds: [], defaultCategoryOverrides: {},
        subcategories: [{ id: 'numeric', parentId: 'science', name: 'Numerical Methods and Scientific Libraries', icon: '' }, { id: 'data', parentId: 'science', name: 'Data Processing', icon: '' }],
        categoryOrder: ['science', 'tools'], subcategoryOrder: ['numeric', 'data'], classificationContext: 'technology', activeClassificationScheme: 'purpose',
        classificationNavigation: { purpose: { selected: 'all', expanded: [] } }, selectedCategory: 'all', isSidebarCollapsed: false,
        currentView: 'repositories', language: 'en', syncModeConfigured: true, aiConfigs: [], activeAIConfig: null });
    });
    const output = path.resolve(__dirname, '../output/category-sidebar-tree'); fs.mkdirSync(output, { recursive: true });
    const main = page.getByRole('button', { name: /Scientific Research and Numerical Computing 12/ });
    await main.click();
    await page.getByRole('button', { name: 'Numerical Methods and Scientific Libraries 7' }).waitFor();
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    await page.getByRole('button', { name: 'Data Processing 5' }).click();
    await page.screenshot({ path: path.join(output, 'desktop-child.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'narrow.png') });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflows at narrow viewport');
    console.log('Direct main/child navigation and screenshots passed using synthetic data.');
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
