import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const baseUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:4321';
const outputDir = 'artifacts/pr-preview';

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function capture(name, path, viewport) {
  const page = await browser.newPage({ viewport });
  try {
    await page.goto(`${baseUrl}${path}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    });
    await page.waitForTimeout(1_200);
    await page.screenshot({
      path: `${outputDir}/${name}.png`,
      fullPage: false
    });
    console.log(`Captured ${name}: ${baseUrl}${path}`);
  } finally {
    await page.close();
  }
}

try {
  await capture('home-desktop', '/', { width: 1440, height: 1100 });
  await capture('emojis-desktop', '/emojis', { width: 1440, height: 1100 });
  await capture('home-mobile', '/', { width: 390, height: 844 });
  await capture('emojis-mobile', '/emojis', { width: 390, height: 844 });
} finally {
  await browser.close();
}
