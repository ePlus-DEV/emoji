import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  detectImageAsset,
  isCandidateAssetUrl,
  validateImageAsset
} from './lib/emojigg-asset.mjs';

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const pair = args.find((arg) => arg.startsWith(`--${name}=`));
  if (pair) return pair.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const categoryFilter = String(valueFor('category', 'all')).trim();
const limitPerCategoryRaw = Number.parseInt(valueFor('limit-per-category', '1000'), 10);
const limitPerCategory = Number.isFinite(limitPerCategoryRaw) ? Math.max(0, limitPerCategoryRaw) : 1000;
const concurrency = Math.max(1, Math.min(10, Number.parseInt(valueFor('concurrency', '8'), 10) || 8));
const maxPagesPerCategory = Math.max(1, Math.min(5000, Number.parseInt(valueFor('max-pages-per-category', '1500'), 10) || 1500));
const emptyPageStop = Math.max(1, Math.min(10, Number.parseInt(valueFor('empty-page-stop', '3'), 10) || 3));
const maxBytes = 8 * 1024 * 1024;

const SOURCE = {
  id: 'emojigg',
  label: 'Emoji.gg',
  home: 'https://emoji.gg/',
  detailPattern: /^\/emoji\/(?:\d+-)?[^/?#]+/i,
  categoryPattern: /^\/category\/(\d+)(?:\/([^/?#]+))?\/?$/i
};

const DATA_FILE = path.resolve('src/data/emojis.json');
const API_FILE = path.resolve('public/api/emojis.json');
const STATE_FILE = path.resolve('src/data/community-sync-state.json');
const CATEGORY_DATA_FILE = path.resolve('src/data/categories.json');
const CATEGORY_API_FILE = path.resolve('public/api/categories.json');
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

function shortcode(value) {
  return slugify(value).replaceAll('-', '_') || 'emoji';
}

function absoluteUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return ''; }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return value;
  }
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

function categoryFromHref(href, label = '') {
  const url = absoluteUrl(href, SOURCE.home);
  if (!url) return null;
  const parsed = new URL(url);
  const match = parsed.pathname.match(SOURCE.categoryPattern);
  if (!match) return null;
  const id = match[1];
  const pathSlug = slugify(match[2] || '');
  const cleanLabel = String(label || '').replace(/\s+Emojis?$/i, '').trim();
  const name = cleanLabel || (pathSlug ? pathSlug.replace(/-/g, ' ') : `Category ${id}`);
  const slug = pathSlug || slugify(name) || `category-${id}`;
  return { id, slug, name, url: `${parsed.origin}${parsed.pathname}` };
}

async function discoverCategories(page) {
  await page.goto(SOURCE.home, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(500);

  const links = await page.locator('a[href*="/category/"]').evaluateAll((nodes) =>
    nodes.map((node) => ({ href: node.getAttribute('href') || '', text: (node.textContent || '').trim() }))
  );

  const categories = new Map();
  for (const link of links) {
    const category = categoryFromHref(link.href, link.text);
    if (!category) continue;
    if (!categories.has(category.id) || categories.get(category.id).name.startsWith('Category ')) {
      categories.set(category.id, category);
    }
  }

  const result = [...categories.values()].sort((a, b) => Number(a.id) - Number(b.id));
  if (!result.length) throw new Error('Emoji.gg returned no category links');
  console.log(`[${SOURCE.label}] discovered ${result.length} categories: ${result.map((item) => `${item.id}:${item.slug}`).join(', ')}`);
  return result;
}

function selectCategories(categories) {
  if (!categoryFilter || categoryFilter.toLowerCase() === 'all') return categories;
  const wanted = categoryFilter.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const selected = categories.filter((category) => wanted.some((value) =>
    value === category.id || value === category.slug.toLowerCase() || value === category.name.toLowerCase()
  ));
  if (!selected.length) {
    throw new Error(`No Emoji.gg category matched "${categoryFilter}". Available: ${categories.map((item) => `${item.id}:${item.slug}`).join(', ')}`);
  }
  return selected;
}

async function discoverCategoryUrls(page, category) {
  const urls = new Set();
  const visitedPages = new Set();
  let nextUrl = category.url;
  let pageNumber = 0;
  let consecutiveEmpty = 0;
  let canonicalName = category.name;

  while (nextUrl && pageNumber < maxPagesPerCategory && !visitedPages.has(nextUrl)) {
    visitedPages.add(nextUrl);
    pageNumber += 1;

    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(350);

    if (pageNumber === 1) {
      const heading = await page.locator('h1').first().textContent().catch(() => '');
      const cleaned = String(heading || '').replace(/\s+Emojis?$/i, '').trim();
      if (cleaned) canonicalName = cleaned;
    }

    const hrefs = await page.locator('a[href*="/emoji/"]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href')).filter(Boolean)
    );

    let added = 0;
    for (const href of hrefs) {
      const url = absoluteUrl(href, page.url());
      if (!url) continue;
      try {
        if (!SOURCE.detailPattern.test(new URL(url).pathname)) continue;
      } catch {
        continue;
      }
      const normalized = normalizeUrl(url);
      if (!urls.has(normalized)) {
        urls.add(normalized);
        added += 1;
      }
    }

    consecutiveEmpty = added === 0 ? consecutiveEmpty + 1 : 0;
    console.log(`[${SOURCE.label}/${category.slug}] page ${pageNumber}: +${added}, total ${urls.size}${added === 0 ? ` (empty ${consecutiveEmpty}/${emptyPageStop})` : ''}`);

    if (consecutiveEmpty >= emptyPageStop) {
      console.log(`[${SOURCE.label}/${category.slug}] stopping after ${emptyPageStop} consecutive pages with no new emoji.`);
      break;
    }

    const nextHref = await page
      .locator('a')
      .filter({ hasText: /^\s*Next Page\s*$/i })
      .first()
      .getAttribute('href')
      .catch(() => '');

    const candidate = absoluteUrl(nextHref, page.url());
    nextUrl = candidate && !visitedPages.has(candidate) ? candidate : '';
  }

  return {
    category: { ...category, name: canonicalName, slug: slugify(canonicalName) || category.slug },
    urls: [...urls].sort(),
    pages: visitedPages.size
  };
}

async function extractDetail(page, detailUrl, fallbackCategory) {
  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(350);

  const title = await page.locator('meta[property="og:title"]').getAttribute('content').catch(() => '')
    || await page.locator('h1').first().textContent().catch(() => '')
    || path.basename(new URL(detailUrl).pathname);

  const cleanName = String(title)
    .replace(/\s*[|–-]\s*(Emoji\.gg|Discord Emoji).*$/i, '')
    .replace(/^:+|:+$/g, '')
    .replace(/\s+Discord Emoji$/i, '')
    .replace(/\s+Emoji$/i, '')
    .trim() || path.basename(new URL(detailUrl).pathname).replace(/^\d+-/, '');

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const categoryMatch = String(bodyText).match(/Category:\s*([^\n\r]+)/i);
  const canonicalCategoryName = categoryMatch?.[1]?.trim() || fallbackCategory.name;
  const canonicalCategory = {
    ...fallbackCategory,
    name: canonicalCategoryName,
    slug: slugify(canonicalCategoryName) || fallbackCategory.slug
  };

  const candidates = await page.locator('a[href], img[src], img[data-src], source[src]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      href: node.getAttribute('href') || '',
      src: node.getAttribute('src') || node.getAttribute('data-src') || '',
      text: (node.textContent || '').trim()
    }))
  );

  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content').catch(() => '');
  const urls = [
    ...candidates.filter((item) => /download/i.test(`${item.href} ${item.text}`)).map((item) => item.href),
    ogImage,
    ...candidates.map((item) => item.src)
  ]
    .map((url) => absoluteUrl(url, detailUrl))
    .filter(Boolean);

  const assetUrls = [...new Set(urls.filter(isCandidateAssetUrl))];
  if (!assetUrls.length) throw new Error('no downloadable emoji image found');

  return { name: cleanName, assetUrls, category: canonicalCategory };
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

  throw new Error(`no valid downloadable emoji image found: ${failures.slice(0, 3).join('; ')}`);
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

function migrateLegacyEmojiGg(record) {
  if (record.source !== 'emojigg-pepe') return record;
  return {
    ...record,
    source: SOURCE.id,
    sourceLabel: SOURCE.label,
    category: record.category || 'Pepe',
    categorySlug: record.categorySlug || 'pepe',
    categoryId: record.categoryId || '13',
    subgroup: record.subgroup === 'emojigg-pepe' ? 'emojigg-pepe' : record.subgroup,
    tags: [...new Set([...(record.tags || []), 'emojigg', 'pepe'])]
  };
}

async function pruneInvalidExistingEmojiGg(records) {
  const valid = [];
  let removed = 0;

  for (const record of records) {
    if (record.source !== SOURCE.id || !String(record.image || '').startsWith('/emojis/community/')) {
      valid.push(record);
      continue;
    }

    const localPath = path.resolve('public', String(record.image).replace(/^\//, ''));
    try {
      const buffer = await readFile(localPath);
      if (!detectImageAsset(buffer)) {
        removed += 1;
        console.warn(`[${SOURCE.label}] dropping invalid existing asset ${record.id}: ${record.image}`);
        continue;
      }
    } catch (error) {
      removed += 1;
      console.warn(`[${SOURCE.label}] dropping unreadable existing asset ${record.id}: ${error.message}`);
      continue;
    }

    valid.push(record);
  }

  if (removed) console.warn(`[${SOURCE.label}] removed ${removed} invalid existing record(s) before sync.`);
  return valid;
}

let existing = (await readJson(DATA_FILE, [])).map(migrateLegacyEmojiGg);
existing = await pruneInvalidExistingEmojiGg(existing);
const byId = new Map(existing.map((emoji) => [emoji.id, emoji]));
const bySourceUrl = new Map(existing.filter((emoji) => emoji.sourceUrl).map((emoji) => [normalizeUrl(emoji.sourceUrl), emoji.id]));
const byHash = new Map(existing.filter((emoji) => emoji.assetSha256).map((emoji) => [emoji.assetSha256, emoji.id]));
const state = await readJson(STATE_FILE, {});
state[SOURCE.id] ||= { categories: {} };
state[SOURCE.id].categories ||= {};

const browser = await chromium.launch({ headless: true });
try {
  const discoveryPage = await browser.newPage();
  const categories = selectCategories(await discoverCategories(discoveryPage));
  await discoveryPage.close();

  console.log(`[${SOURCE.label}] selected ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}. limit/category=${limitPerCategory === 0 ? 'ALL' : limitPerCategory}`);

  for (const category of categories) {
    const page = await browser.newPage();
    let discovery;
    try {
      discovery = await discoverCategoryUrls(page, category);
    } finally {
      await page.close();
    }

    const resolvedCategory = discovery.category;
    const missing = discovery.urls.filter((url) => !bySourceUrl.has(normalizeUrl(url)));
    const chosen = limitPerCategory === 0 ? missing : missing.slice(0, limitPerCategory);

    state[SOURCE.id].categories[resolvedCategory.slug] = {
      id: resolvedCategory.id,
      name: resolvedCategory.name,
      url: resolvedCategory.url,
      discovered: discovery.urls.length,
      missingBeforeRun: missing.length,
      attemptedThisRun: chosen.length,
      pagesDiscovered: discovery.pages,
      lastRunAt: new Date().toISOString()
    };

    console.log(`[${SOURCE.label}/${resolvedCategory.slug}] discovered=${discovery.urls.length}, alreadyIndexed=${discovery.urls.length - missing.length}, missing=${missing.length}, importing=${chosen.length}`);

    await runPool(chosen, async (detailUrl) => {
      const detailPage = await browser.newPage();
      try {
        const detail = await extractDetail(detailPage, detailUrl, resolvedCategory);
        const remoteKey = path.basename(new URL(detailUrl).pathname).replace(/[^a-zA-Z0-9_-]+/g, '-');
        const stableId = `emojigg-${slugify(remoteKey || detail.name)}`;
        const asset = await downloadAsset(detailPage.context(), detailUrl, detail.assetUrls, stableId);
        const duplicateOf = byHash.get(asset.hash);
        const now = new Date().toISOString().slice(0, 10);

        const record = {
          ...(byId.get(stableId) || {}),
          id: stableId,
          slug: stableId,
          name: detail.name,
          shortcode: shortcode(detail.name),
          emoji: '',
          hexcode: '',
          group: 'community',
          subgroup: `emojigg-${detail.category.slug}`,
          category: detail.category.name,
          categorySlug: detail.category.slug,
          categoryId: detail.category.id,
          tags: [...new Set([
            'community', 'emojigg', detail.category.slug,
            asset.animated ? 'animated' : 'static', asset.format,
            ...slugify(detail.name).split('-')
          ])].filter(Boolean),
          source: SOURCE.id,
          sourceLabel: SOURCE.label,
          sourceUrl: normalizeUrl(detailUrl),
          image: asset.image,
          format: asset.format,
          animated: asset.animated,
          license: 'COMMUNITY-SOURCE',
          attribution: SOURCE.label,
          addedAt: byId.get(stableId)?.addedAt || now,
          syncedAt: now,
          assetSha256: asset.hash,
          duplicateAsset: Boolean(duplicateOf && duplicateOf !== stableId),
          duplicateOf: duplicateOf && duplicateOf !== stableId ? duplicateOf : null
        };

        byId.set(stableId, record);
        bySourceUrl.set(normalizeUrl(detailUrl), stableId);
        if (!duplicateOf) byHash.set(asset.hash, stableId);
        console.log(`[${SOURCE.label}/${detail.category.slug}] ${detail.name} -> ${asset.format}${asset.animated ? ' animated' : ''}`);
      } catch (error) {
        console.warn(`[${SOURCE.label}/${resolvedCategory.slug}] skipped ${detailUrl}: ${error.message}`);
      } finally {
        await detailPage.close();
      }
    }, concurrency);

    const remaining = discovery.urls.filter((url) => !bySourceUrl.has(normalizeUrl(url))).length;
    state[SOURCE.id].categories[resolvedCategory.slug].remainingAfterRun = remaining;
    state[SOURCE.id].categories[resolvedCategory.slug].complete = remaining === 0;
    console.log(`[${SOURCE.label}/${resolvedCategory.slug}] remaining=${remaining}, complete=${remaining === 0}`);
  }

  state[SOURCE.id].lastRunAt = new Date().toISOString();
  state[SOURCE.id].selectedCategory = categoryFilter;
} finally {
  await browser.close();
}

const communitySources = new Set(['slackmojis', 'discadia', 'emojigg-pepe', SOURCE.id]);
const all = [...byId.values()].sort((a, b) => {
  const community = Number(communitySources.has(b.source)) - Number(communitySources.has(a.source));
  if (community) return community;
  const category = String(a.category || '').localeCompare(String(b.category || ''));
  if (category) return category;
  const animated = Number(Boolean(b.animated)) - Number(Boolean(a.animated));
  if (animated) return animated;
  return String(a.name).localeCompare(String(b.name));
});

const categoryCounts = new Map();
for (const emoji of all) {
  if (emoji.source !== SOURCE.id || !emoji.categorySlug) continue;
  const key = emoji.categorySlug;
  const current = categoryCounts.get(key) || {
    id: emoji.categoryId || '',
    slug: emoji.categorySlug,
    name: emoji.category || emoji.categorySlug,
    source: SOURCE.id,
    count: 0,
    animated: 0,
    static: 0
  };
  current.count += 1;
  if (emoji.animated) current.animated += 1;
  else current.static += 1;
  categoryCounts.set(key, current);
}
const categoryIndex = [...categoryCounts.values()].sort((a, b) => a.name.localeCompare(b.name));

await writeJson(DATA_FILE, all);
await writeJson(API_FILE, all);
await writeJson(STATE_FILE, state);
await writeJson(CATEGORY_DATA_FILE, categoryIndex);
await writeJson(CATEGORY_API_FILE, categoryIndex);
console.log(`Done. ${all.length} total emoji records indexed across ${categoryIndex.length} Emoji.gg categories.`);
