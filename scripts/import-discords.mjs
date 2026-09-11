import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateImageAsset } from './lib/emojigg-asset.mjs';
import {
  discordEmojiAssetInfo,
  discordsTagInfo,
  discordsTagUrl
} from './lib/discords.mjs';

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const pair = args.find((arg) => arg.startsWith(`--${name}=`));
  if (pair) return pair.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const tag = String(valueFor('tag', 'home')).trim();
const rawLimit = Number.parseInt(valueFor('limit', '200'), 10);
const limit = Number.isFinite(rawLimit) ? Math.max(0, rawLimit) : 200;
const concurrency = Math.max(1, Math.min(8, Number.parseInt(valueFor('concurrency', '4'), 10) || 4));
const maxPages = Math.max(1, Math.min(100, Number.parseInt(valueFor('max-pages', '10'), 10) || 10));
const delayMs = Math.max(0, Math.min(5000, Number.parseInt(valueFor('delay-ms', '300'), 10) || 0));
const maxBytes = 8 * 1024 * 1024;

const SOURCE = {
  id: 'discords',
  label: 'Discords.com',
  home: 'https://discords.com/emoji-list'
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

function pagedUrl(url, pageNumber) {
  const parsed = new URL(url);
  if (pageNumber > 1) parsed.searchParams.set('page', String(pageNumber));
  return parsed.toString();
}

async function discoverTagUrls(page) {
  await page.goto(SOURCE.home, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (delayMs) await page.waitForTimeout(delayMs);

  const hrefs = await page.locator('a[href*="/emoji-list/tag/"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')).filter(Boolean)
  );

  const tags = new Map();
  for (const href of hrefs) {
    const info = discordsTagInfo(href);
    if (info) tags.set(info.slug.toLowerCase(), info);
  }
  return [...tags.values()];
}

async function resolveTargets(page) {
  const normalized = tag.toLowerCase();
  if (normalized === 'home' || normalized === 'trending') {
    return [{ slug: 'home', name: 'Trending', url: SOURCE.home }];
  }
  if (normalized === 'all') {
    const tags = await discoverTagUrls(page);
    return [{ slug: 'home', name: 'Trending', url: SOURCE.home }, ...tags];
  }
  const info = discordsTagInfo(discordsTagUrl(tag));
  return [info || { slug: slugify(tag), name: titleize(tag), url: discordsTagUrl(tag) }];
}

async function discoverImages(page, target, remainingLimit) {
  const found = new Map();
  let consecutiveEmpty = 0;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const url = pagedUrl(target.url, pageNumber);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    if (delayMs) await page.waitForTimeout(delayMs);

    const images = await page.locator('img').evaluateAll((nodes) => nodes.map((node) => ({
      src: node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('data-lazy-src') || '',
      alt: node.getAttribute('alt') || '',
      title: node.getAttribute('title') || ''
    })));

    let added = 0;
    for (const image of images) {
      const info = discordEmojiAssetInfo(image.src, image.alt || image.title, url);
      if (!info || found.has(info.id)) continue;
      found.set(info.id, { ...info, tag: target.slug, tagName: target.name });
      added += 1;
      if (remainingLimit > 0 && found.size >= remainingLimit) break;
    }

    console.log(`[${SOURCE.label}/${target.slug}] page ${pageNumber}: +${added}, total ${found.size}`);
    if (remainingLimit > 0 && found.size >= remainingLimit) break;
    consecutiveEmpty = added === 0 ? consecutiveEmpty + 1 : 0;
    if (consecutiveEmpty >= 2) break;
  }

  return [...found.values()];
}

async function downloadAsset(context, item) {
  const response = await context.request.get(item.assetUrl, {
    headers: {
      Referer: item.pageUrl,
      'User-Agent': 'Mozilla/5.0 VietnamAwesomeEmojiBot/1.0'
    },
    timeout: 60000
  });
  if (!response.ok()) throw new Error(`HTTP ${response.status()}`);

  const buffer = await response.body();
  if (!buffer.length || buffer.length > maxBytes) throw new Error(`size ${buffer.length} is invalid`);
  const contentType = response.headers()['content-type'] || '';
  const detected = validateImageAsset(buffer, contentType, item.assetUrl);

  await mkdir(OUT_ROOT, { recursive: true });
  const filename = `${item.id}${detected.ext}`;
  await writeFile(path.join(OUT_ROOT, filename), buffer);

  return {
    ...detected,
    hash: hashBuffer(buffer),
    image: `/emojis/community/${SOURCE.id}/${filename}`
  };
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
const byHash = new Map(existing.filter((emoji) => emoji.assetSha256).map((emoji) => [emoji.assetSha256, emoji.id]));
const state = await readJson(STATE_FILE, {});

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
let discovered = [];
let imported = 0;
let failed = 0;

try {
  const page = await context.newPage();
  try {
    const targets = await resolveTargets(page);
    const seen = new Map();
    for (const target of targets) {
      const remaining = limit === 0 ? 0 : Math.max(0, limit - seen.size);
      if (limit > 0 && remaining === 0) break;
      const items = await discoverImages(page, target, remaining);
      for (const item of items) if (!seen.has(item.id)) seen.set(item.id, item);
    }
    discovered = [...seen.values()];
  } finally {
    await page.close();
  }

  const missing = discovered.filter((item) => !byId.has(`discords-${item.id}`));
  const chosen = limit === 0 ? missing : missing.slice(0, limit);
  console.log(`[${SOURCE.label}] discovered=${discovered.length}, missing=${missing.length}, selected=${chosen.length}`);

  await runPool(chosen, async (item, index) => {
    try {
      const asset = await downloadAsset(context, item);
      const now = new Date().toISOString();
      const id = `discords-${item.id}`;
      const current = byId.get(id);
      const duplicateId = byHash.get(asset.hash);
      const short = slugify(item.name) || `emoji-${item.id}`;

      const record = {
        id,
        slug: `discords-${short}-${item.id}`,
        name: item.name || `Discord Emoji ${item.id}`,
        shortcode: short.replaceAll('-', '_'),
        group: 'community',
        subgroup: item.tag === 'home' ? 'discords' : `discords-${slugify(item.tag)}`,
        category: item.tagName || titleize(item.tag),
        categorySlug: slugify(item.tagName || item.tag),
        tags: [...new Set(['discords', 'discord', 'custom-emoji', item.tag, asset.animated ? 'animated' : 'static'].filter(Boolean))],
        source: SOURCE.id,
        sourceLabel: SOURCE.label,
        sourceUrl: item.pageUrl,
        upstreamAssetUrl: item.assetUrl,
        image: asset.image,
        format: asset.format,
        animated: asset.animated,
        license: 'Source terms / rights vary',
        attribution: 'Discords.com / Discord CDN / original server contributor',
        addedAt: current?.addedAt || now.slice(0, 10),
        syncedAt: now,
        assetSha256: asset.hash,
        duplicateAsset: Boolean(duplicateId && duplicateId !== id)
      };

      byId.set(id, record);
      if (!byHash.has(asset.hash)) byHash.set(asset.hash, id);
      imported += 1;
      console.log(`[${SOURCE.label}] ${index + 1}/${chosen.length} imported ${record.shortcode}`);
    } catch (error) {
      failed += 1;
      console.warn(`[${SOURCE.label}] ${item.assetUrl} skipped: ${error.message}`);
    }
  }, concurrency);

  state[SOURCE.id] = {
    tag,
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
