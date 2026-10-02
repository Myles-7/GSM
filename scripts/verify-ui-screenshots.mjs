import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  console.log('Navigating to http://127.0.0.1:5174...');
  await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle', timeout: 15000 });

  const title = await page.title();
  console.log('Page title:', title);

  const outDir = path.resolve('output/playwright');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Take initial overview screenshot
  await page.screenshot({ path: path.join(outDir, '01-repo-overview.png') });
  console.log('Saved 01-repo-overview.png');

  // Check if advanced filter button exists
  const filterBtn = page.getByRole('button', { name: /筛选|filter/i });
  if (await filterBtn.count() > 0) {
    await filterBtn.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, '02-filter-panel.png') });
    console.log('Saved 02-filter-panel.png');
  }

  // Hover over first repository card
  const repoCards = page.locator('[data-testid="repository-card"], article, .group.relative');
  const cardCount = await repoCards.count();
  console.log('Found cards:', cardCount);
  if (cardCount > 0) {
    const firstCard = repoCards.first();
    await firstCard.hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, '03-card-hover.png') });
    console.log('Saved 03-card-hover.png');
  }

  await browser.close();
  console.log('Verification screenshot run completed.');
}

run().catch((err) => {
  console.error('Error during verification screenshot:', err);
  process.exit(1);
});
