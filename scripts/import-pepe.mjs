import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const pair = args.find((arg) => arg.startsWith(`--${name}=`));
  if (pair) return pair.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const limit = Math.max(1, Number.parseInt(valueFor('limit', '300'), 10) || 300);
const concurrency = Math.max(1, Math.min(8, Number.parseInt(valueFor('concurrency', '6'), 10) || 6));
const maxPages = Math.max(1, Math.min(500, Number.parseInt(valueFor('max-pages', '250'), 10) || 250));
const maxBytes = 8 * 1024 * 1024;

const SOURCE = {
  id: 'emojigg-pepe',
  label: 'Emoji.gg Pepe',
  home: 'https://emoji.gg/',
  list: 'https://emoji.gg/category/13/pepe',
  detailPattern: /\/emoji\/\d+-[^/?#]+/i
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

function shortcode(value) {
  return slugify(value).replaceAll('-', '_') || 'emoji';
}

function absoluteUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return ''; }
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function detectAsset(buffer, contentType = '', url = '') {
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return { ext: '.gif', format: 'gif', animated: true };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: '.webp', format: 'webp', animated: true };
  if (buffer.length >= 8 && buffer.subarray(1, 4).toString('ascii') === 'PNG') return { ext: '.png', format: 'png', animated: false };
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return { ext: '.jpg', format: 'jpg', animated: false };
  const lower = `${contentType} ${url}`.toLowerCase();
  if (lower.includes('gif')) return { ext: '.gif', format: 'gif', animated: true };
  if (lower.includes('webp')) return { ext: '.webp', format: 'webp', animated: true };
  if (lower.includes('jpeg') || lower.includes('.jpg') || lower.includes('.jpeg')) return { ext: '.jpg', format: 'jpg', animated: false };
  return { ext: '.png', format: 'png', animated: false };
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function discoverDetailUrls(page) {
  const urls = new Set();
  const visitedPages = new Set();
  let nextUrl = SOURCE.list;
  let pageNumber = 0;

  while (nextUrl && pageNumber < maxPages && !visitedPages.has(nextUrl)) {
    visitedPages.add(nextUrl);
    pageNumber += 1;

    await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(450);

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
      if (!urls.has(url)) {
        urls.add(url);
        added += 1;
      }
    }

    console.log(`[${SOURCE.label}] page ${pageNumber}: +${added}, total ${urls.size}`);

    const nextHref = await page
      .locator('a')
      .filter({ hasText: /^\s*Next Page\s*$/i })
      .first()
      .getAttribute('href')
      .catch(() => '');

    const candidate = absoluteUrl(nextHref, page.url());
    nextUrl = candidate && !visitedPages.has(candidate) ? candidate : '';
  }

  return { urls: [...urls].sort(), pages: visitedPages.size };
}

async function extractDetail(page, detailUrl) {
  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(450);

  const title = await page.locator('meta[property="og:title"]').getAttribute('content').catch(() => '')
    || await page.locator('h1').first().textContent().catch(() => '')
    || path.basename(new URL(detailUrl).pathname);

  const cleanName = String(title)
    .replace(/\s*[|–-]\s*(Emoji\.gg|Discord Emoji).*$/i, '')
    .replace(/^:+|:+$/g, '')
    .replace(/\s+Emoji$/i, '')
    .trim() || path.basename(new URL(detailUrl).pathname).replace(/^\d+-/, '');

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

  const assetUrl = urls.find((url) => {
    try {
      const parsed = new URL(url);
      const value = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
      return /\.(png|gif|webp|jpe?g)(\?|$)/i.test(parsed.pathname + parsed.search)
        && !/logo|avatar|favicon|banner|ads?\//i.test(value);
    } catch {
      return false;
    }
  });

  if (!assetUrl) throw new Error('no downloadable emoji image found');
  return { name: cleanName, assetUrl };
}

async function downloadAsset(context, detailUrl, assetUrl, stableId) {
  const response = await context.request.get(assetUrl, {
    headers: {
      Referer: detailUrl,
      'User-Agent': 'Mozilla/5.0 ePlusEmojiBot/1.0'
    },
    timeout: 60000
  });

  if (!response.ok()) throw new Error(`asset HTTP ${response.status()}`);
  const buffer = await response.body();
  if (!buffer.length || buffer.length > maxBytes) throw new Error(`asset size ${buffer.length} is invalid`);

  const detected = detectAsset(buffer, response.headers()['content-type'] || '', assetUrl);
  await mkdir(OUT_ROOT, { recursive: true });
  const filename = `${stableId}${detected.ext}`;
  await writeFile(path.join(OUT_ROOT, filename), buffer);

  return {
    ...detected,
    hash: hashBuffer(buffer),
    image: `/emojis/community/${SOURCE.id}/${filename}`
  };
}

async function runPool(items, worker, size) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
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
try {
  const discoveryPage = await browser.newPage();
  const discovery = await discoverDetailUrls(discoveryPage);
  await discoveryPage.close();

  const discovered = discovery.urls;
  if (!discovered.length) throw new Error('Emoji.gg Pepe category returned no emoji detail URLs');

  const previousCursor = Number(state[SOURCE.id]?.cursor || 0);
  const start = previousCursor % discovered.length;
  const chosen = Array.from(
    { length: Math.min(limit, discovered.length) },
    (_, index) => discovered[(start + index) % discovered.length]
  );

  state[SOURCE.id] = {
    cursor: (start + chosen.length) % discovered.length,
    discovered: discovered.length,
    pagesDiscovered: discovery.pages,
    lastRunAt: new Date().toISOString()
  };

  console.log(`[${SOURCE.label}] discovered ${discovered.length} across ${discovery.pages} pages; importing ${chosen.length} from cursor ${start}.`);

  await runPool(chosen, async (detailUrl) => {
    const page = await browser.newPage();
    try {
      const detail = await extractDetail(page, detailUrl);
      const remoteKey = path.basename(new URL(detailUrl).pathname).replace(/[^a-zA-Z0-9_-]+/g, '-');
      const stableId = `${SOURCE.id}-${slugify(remoteKey || detail.name)}`;
      const asset = await downloadAsset(page.context(), detailUrl, detail.assetUrl, stableId);
      const duplicateOf = byHash.get(asset.hash);
      const now = new Date().toISOString().slice(0, 10);

      byId.set(stableId, {
        ...(byId.get(stableId) || {}),
        id: stableId,
        slug: `${SOURCE.id}-${slugify(detail.name)}-${slugify(remoteKey)}`.replace(/-+$/g, ''),
        name: detail.name,
        shortcode: shortcode(detail.name),
        emoji: '',
        hexcode: '',
        group: 'community',
        subgroup: SOURCE.id,
        tags: [...new Set([
          'community', 'pepe', 'frog', 'meme', SOURCE.id,
          asset.animated ? 'animated' : 'static', asset.format,
          ...slugify(detail.name).split('-')
        ])].filter(Boolean),
        source: SOURCE.id,
        sourceLabel: SOURCE.label,
        sourceUrl: detailUrl,
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
      });

      if (!duplicateOf) byHash.set(asset.hash, stableId);
      console.log(`[${SOURCE.label}] ${detail.name} -> ${asset.format}${asset.animated ? ' animated' : ''}`);
    } catch (error) {
      console.warn(`[${SOURCE.label}] skipped ${detailUrl}: ${error.message}`);
    } finally {
      await page.close();
    }
  }, concurrency);
} finally {
  await browser.close();
}

const communitySources = new Set(['slackmojis', 'discadia', SOURCE.id]);
const all = [...byId.values()].sort((a, b) => {
  const community = Number(communitySources.has(b.source)) - Number(communitySources.has(a.source));
  if (community) return community;
  const animated = Number(Boolean(b.animated)) - Number(Boolean(a.animated));
  if (animated) return animated;
  return String(a.name).localeCompare(String(b.name));
});

await writeJson(DATA_FILE, all);
await writeJson(API_FILE, all);
await writeJson(STATE_FILE, state);
console.log(`Done. ${all.length} total emoji records indexed.`);
