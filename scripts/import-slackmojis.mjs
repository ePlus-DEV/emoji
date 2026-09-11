import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateImageAsset } from './lib/emojigg-asset.mjs';
import {
  slackmojisCollectionUrls,
  slackmojisDetailInfo,
  slackmojisDownloadUrl
} from './lib/slackmojis.mjs';

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const pair = args.find((arg) => arg.startsWith(`--${name}=`));
  if (pair) return pair.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const collection = String(valueFor('collection', 'recent')).trim().toLowerCase();
const rawLimit = Number.parseInt(valueFor('limit', '200'), 10);
const limit = Number.isFinite(rawLimit) ? Math.max(0, rawLimit) : 200;
const concurrency = Math.max(1, Math.min(8, Number.parseInt(valueFor('concurrency', '4'), 10) || 4));
const delayMs = Math.max(0, Math.min(5000, Number.parseInt(valueFor('delay-ms', '200'), 10) || 0));
const maxBytes = 8 * 1024 * 1024;

const SOURCE = {
  id: 'slackmojis',
  label: 'Slackmojis',
  home: 'https://slackmojis.com/'
};

const DATA_FILE = path.resolve('src/data/emojis.json');
const API_FILE = path.resolve('public/api/emojis.json');
const STATE_FILE = path.resolve('src/data/community-sync-state.json');
const OUT_ROOT = path.resolve('public/emojis/community', SOURCE.id);

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function titleize(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function discoverDetailUrls(page, urls) {
  const discovered = new Map();

  for (const collectionUrl of urls) {
    console.log(`[${SOURCE.label}] reading ${collectionUrl}`);
    await page.goto(collectionUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (delayMs) await page.waitForTimeout(delayMs);

    const links = await page.locator('a[href]').evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.getAttribute('href') || '',
        text: (node.textContent || '').trim()
      }))
    );

    let added = 0;
    for (const link of links) {
      let absolute = '';
      try { absolute = new URL(link.href, collectionUrl).toString(); } catch { continue; }
      const detail = slackmojisDetailInfo(absolute);
      if (!detail || discovered.has(detail.url)) continue;
      discovered.set(detail.url, { ...detail, linkText: link.text });
      added += 1;
    }

    console.log(`[${SOURCE.label}] ${collectionUrl}: +${added}, total ${discovered.size}`);
  }

  return [...discovered.values()];
}

async function extractDetail(page, detail) {
  await page.goto(detail.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (delayMs) await page.waitForTimeout(delayMs);

  const pageTitle = await page.title().catch(() => '');
  const titleName = String(pageTitle || '')
    .replace(/\s+Emoji\s+(?:—|-).*$/i, '')
    .replace(/\s+Emoji\s+for\s+Slack.*$/i, '')
    .trim();

  const hrefs = await page.locator('a[href], img[src], img[data-src], source[src]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      href: node.getAttribute('href') || '',
      src: node.getAttribute('src') || node.getAttribute('data-src') || '',
      text: (node.textContent || '').trim()
    }))
  );
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content').catch(() => '');

  const candidates = [slackmojisDownloadUrl(detail.url)];
  for (const item of hrefs) {
    for (const value of [item.href, item.src]) {
      if (!value) continue;
      let absolute = '';
      try { absolute = new URL(value, detail.url).toString(); } catch { continue; }
      if (/\/download(?:[/?#]|$)/i.test(absolute) || /\.(?:png|gif|webp|jpe?g)(?:[?#]|$)/i.test(absolute)) {
        candidates.push(absolute);
      }
    }
  }
  if (ogImage) {
    try { candidates.push(new URL(ogImage, detail.url).toString()); } catch {}
  }

  const shortName = detail.slug || 'emoji';
  return {
    name: titleName && !/^slackmojis$/i.test(titleName) ? titleName : titleize(shortName),
    shortcode: shortName,
    assetUrls: [...new Set(candidates.filter(Boolean))]
  };
}

async function downloadAsset(context, detailUrl, assetUrls, stableId) {
  const failures = [];

  for (const assetUrl of assetUrls) {
    try {
      const response = await context.request.get(assetUrl, {
        headers: {
          Referer: detailUrl,
          'User-Agent': 'Mozilla/5.0 VietnamAwesomeEmojiBot/1.0'
        },
        timeout: 60000
      });
      if (!response.ok()) throw new Error(`HTTP ${response.status()}`);

      const buffer = await response.body();
      if (!buffer.length || buffer.length > maxBytes) throw new Error(`size ${buffer.length} is invalid`);
      const contentType = response.headers()['content-type'] || '';
      const detected = validateImageAsset(buffer, contentType, assetUrl);

      await mkdir(OUT_ROOT, { recursive: true });
      const filename = `${stableId}${detected.ext}`;
      await writeFile(path.join(OUT_ROOT, filename), buffer);

      return {
        ...detected,
        hash: hashBuffer(buffer),
        image: `/emojis/community/${SOURCE.id}/${filename}`
      };
    } catch (error) {
      failures.push(`${assetUrl} -> ${error.message}`);
    }
  }

  throw new Error(`no valid image found: ${failures.slice(0, 4).join('; ')}`);
}

async function runPool(items, worker, size) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

const existing = await readJson(DATA_FILE, []);
const byId = new Map(existing.map((emoji) => [emoji.id, emoji]));
const bySourceUrl = new Map(existing.filter((emoji) => emoji.sourceUrl).map((emoji) => [emoji.sourceUrl, emoji.id]));
const byHash = new Map(existing.filter((emoji) => emoji.assetSha256).map((emoji) => [emoji.assetSha256, emoji.id]));
const state = await readJson(STATE_FILE, {});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
let imported = 0;
let failed = 0;
let discovered = [];

try {
  const discoveryPage = await context.newPage();
  try {
    discovered = await discoverDetailUrls(discoveryPage, slackmojisCollectionUrls(collection));
  } finally {
    await discoveryPage.close();
  }

  const missing = discovered.filter((item) => !byId.has(`slackmojis-${item.id}`) && !bySourceUrl.has(item.url));
  const chosen = limit === 0 ? missing : missing.slice(0, limit);
  console.log(`[${SOURCE.label}] discovered=${discovered.length}, missing=${missing.length}, selected=${chosen.length}`);

  await runPool(chosen, async (detail, index) => {
    const page = await context.newPage();
    try {
      const meta = await extractDetail(page, detail);
      const asset = await downloadAsset(context, detail.url, meta.assetUrls, detail.id);
      const now = new Date().toISOString();
      const id = `slackmojis-${detail.id}`;
      const duplicateId = byHash.get(asset.hash);
      const current = byId.get(id);

      const record = {
        id,
        slug: `slackmojis-${slugify(meta.shortcode || detail.slug)}-${detail.id}`,
        name: meta.name || titleize(detail.slug),
        shortcode: meta.shortcode || detail.slug,
        group: 'community',
        subgroup: 'slackmojis',
        tags: [...new Set(['slackmojis', 'custom-emoji', asset.animated ? 'animated' : 'static'])],
        source: SOURCE.id,
        sourceLabel: SOURCE.label,
        sourceUrl: detail.url,
        image: asset.image,
        format: asset.format,
        animated: asset.animated,
        license: 'Source terms / rights vary',
        attribution: 'Slackmojis / original contributor',
        addedAt: current?.addedAt || now.slice(0, 10),
        syncedAt: now,
        assetSha256: asset.hash,
        duplicateAsset: Boolean(duplicateId && duplicateId !== id)
      };

      byId.set(id, record);
      bySourceUrl.set(detail.url, id);
      if (!byHash.has(asset.hash)) byHash.set(asset.hash, id);
      imported += 1;
      console.log(`[${SOURCE.label}] ${index + 1}/${chosen.length} imported ${record.shortcode}${record.duplicateAsset ? ` (duplicate of ${duplicateId})` : ''}`);
    } catch (error) {
      failed += 1;
      console.warn(`[${SOURCE.label}] ${detail.url} skipped: ${error.message}`);
    } finally {
      await page.close();
    }
  }, concurrency);

  state[SOURCE.id] = {
    collection,
    discovered: discovered.length,
    missingBeforeRun: missing.length,
    attemptedThisRun: chosen.length,
    importedThisRun: imported,
    failedThisRun: failed,
    lastRunAt: new Date().toISOString()
  };

  const all = [...byId.values()].sort((a, b) => {
    const date = String(b.syncedAt || b.addedAt || '').localeCompare(String(a.syncedAt || a.addedAt || ''));
    return date || String(a.name || '').localeCompare(String(b.name || ''));
  });

  await writeJson(DATA_FILE, all);
  await writeJson(API_FILE, all);
  await writeJson(STATE_FILE, state);
  console.log(`[${SOURCE.label}] done. imported=${imported}, failed=${failed}, total=${all.length}`);
} finally {
  await context.close();
  await browser.close();
}
