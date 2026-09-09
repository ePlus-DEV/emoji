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

const requestedSource = valueFor('source', 'all');
const limit = Math.max(1, Number.parseInt(valueFor('limit', '60'), 10) || 60);
const concurrency = Math.max(1, Math.min(6, Number.parseInt(valueFor('concurrency', '4'), 10) || 4));
const maxBytes = 8 * 1024 * 1024;

const DATA_FILE = path.resolve('src/data/emojis.json');
const API_FILE = path.resolve('public/api/emojis.json');
const STATE_FILE = path.resolve('src/data/community-sync-state.json');
const OUT_ROOT = path.resolve('public/emojis/community');

const SOURCES = {
  slackmojis: {
    id: 'slackmojis',
    label: 'Slackmojis',
    home: 'https://slackmojis.com/',
    list: 'https://slackmojis.com/',
    detailPattern: /\/emojis\/\d+[-/][^/?#]+|\/emojis\/\d+-[^/?#]+/i
  },
  discadia: {
    id: 'discadia',
    label: 'Discadia',
    home: 'https://discadia.com/emojis/',
    list: 'https://discadia.com/emojis/',
    detailPattern: /\/emojis\/[^/?#]+/i
  }
};

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

async function discoverFromSitemap(source) {
  const candidates = [
    new URL('/sitemap.xml', source.home).toString(),
    new URL('/sitemap_index.xml', source.home).toString()
  ];
  const seenSitemaps = new Set();
  const pageUrls = new Set();

  async function visit(url, depth = 0) {
    if (depth > 1 || seenSitemaps.has(url) || seenSitemaps.size >= 12) return;
    seenSitemaps.add(url);
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 ePlusEmojiBot/1.0' } });
      if (!response.ok) return;
      const xml = await response.text();
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => match[1].trim());
      for (const loc of locs) {
        if (/\.xml(?:\.gz)?(?:\?|$)/i.test(loc)) await visit(loc, depth + 1);
        else {
          const pathname = new URL(loc).pathname;
          if (source.detailPattern.test(pathname)) pageUrls.add(loc);
        }
      }
    } catch (error) {
      console.warn(`[${source.label}] sitemap skipped ${url}: ${error.message}`);
    }
  }

  for (const candidate of candidates) await visit(candidate);
  return [...pageUrls];
}

async function discoverFromPage(page, source) {
  await page.goto(source.list, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(350);
  }
  const hrefs = await page.locator('a[href]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')).filter(Boolean));
  return [...new Set(hrefs
    .map((href) => absoluteUrl(href, source.home))
    .filter(Boolean)
    .filter((url) => source.detailPattern.test(new URL(url).pathname)))];
}

async function extractDetail(page, source, detailUrl) {
  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(500);

  const title = await page.locator('meta[property="og:title"]').getAttribute('content').catch(() => '')
    || await page.locator('h1').first().textContent().catch(() => '')
    || path.basename(new URL(detailUrl).pathname);

  const cleanName = String(title)
    .replace(/\s*[|–-]\s*(Slackmojis|Discadia).*$/i, '')
    .replace(/^:+|:+$/g, '')
    .trim() || path.basename(new URL(detailUrl).pathname);

  const downloadHref = await page.locator('a[href*="download"], a[download]').first().getAttribute('href').catch(() => '');
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content').catch(() => '');
  const imageSrc = await page.locator('img').evaluateAll((nodes) => {
    const ignored = /logo|avatar|icon|banner/i;
    const choices = nodes.map((node) => ({ src: node.getAttribute('src') || '', alt: node.getAttribute('alt') || '' }));
    return choices.find((item) => item.src && !ignored.test(`${item.src} ${item.alt}`))?.src || '';
  }).catch(() => '');

  const assetUrl = absoluteUrl(downloadHref || ogImage || imageSrc, source.home);
  if (!assetUrl) throw new Error('no downloadable image found');

  return { name: cleanName, assetUrl };
}

async function downloadAsset(context, source, detailUrl, assetUrl, stableId) {
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
  const outDir = path.join(OUT_ROOT, source.id);
  await mkdir(outDir, { recursive: true });
  const filename = `${stableId}${detected.ext}`;
  await writeFile(path.join(outDir, filename), buffer);
  return {
    ...detected,
    hash: hashBuffer(buffer),
    image: `/emojis/community/${source.id}/${filename}`
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

const selectedSources = requestedSource === 'all'
  ? Object.values(SOURCES)
  : [SOURCES[requestedSource]].filter(Boolean);
if (!selectedSources.length) throw new Error(`Unknown source: ${requestedSource}`);

const existing = await readJson(DATA_FILE, []);
const byId = new Map(existing.map((emoji) => [emoji.id, emoji]));
const byHash = new Map(existing.filter((emoji) => emoji.assetSha256).map((emoji) => [emoji.assetSha256, emoji.id]));
const state = await readJson(STATE_FILE, { slackmojis: { cursor: 0 }, discadia: { cursor: 0 } });

const browser = await chromium.launch({ headless: true });
try {
  for (const source of selectedSources) {
    console.log(`\n[${source.label}] discovering emoji pages...`);
    const discoveryPage = await browser.newPage();
    let urls = await discoverFromSitemap(source);
    if (!urls.length) urls = await discoverFromPage(discoveryPage, source);
    await discoveryPage.close();

    urls = [...new Set(urls)].sort();
    if (!urls.length) {
      console.warn(`[${source.label}] no emoji URLs discovered.`);
      continue;
    }

    const previousCursor = Number(state[source.id]?.cursor || 0);
    const start = previousCursor % urls.length;
    const chosen = Array.from({ length: Math.min(limit, urls.length) }, (_, index) => urls[(start + index) % urls.length]);
    state[source.id] = { cursor: (start + chosen.length) % urls.length, discovered: urls.length, lastRunAt: new Date().toISOString() };
    console.log(`[${source.label}] discovered ${urls.length}; importing ${chosen.length} from cursor ${start}.`);

    await runPool(chosen, async (detailUrl) => {
      const page = await browser.newPage();
      try {
        const detail = await extractDetail(page, source, detailUrl);
        const remoteKey = path.basename(new URL(detailUrl).pathname).replace(/[^a-zA-Z0-9_-]+/g, '-');
        const stableId = `${source.id}-${slugify(remoteKey || detail.name)}`;
        const asset = await downloadAsset(page.context(), source, detailUrl, detail.assetUrl, stableId);
        const duplicateOf = byHash.get(asset.hash);
        const now = new Date().toISOString().slice(0, 10);

        byId.set(stableId, {
          ...(byId.get(stableId) || {}),
          id: stableId,
          slug: `${source.id}-${slugify(detail.name)}-${slugify(remoteKey)}`.replace(/-+$/g, ''),
          name: detail.name,
          shortcode: shortcode(detail.name),
          emoji: '',
          hexcode: '',
          group: 'community',
          subgroup: source.id,
          tags: [...new Set(['community', source.id, asset.animated ? 'animated' : 'static', asset.format, ...slugify(detail.name).split('-')])].filter(Boolean),
          source: source.id,
          sourceLabel: source.label,
          sourceUrl: detailUrl,
          image: asset.image,
          format: asset.format,
          animated: asset.animated,
          license: 'COMMUNITY-SOURCE',
          attribution: source.label,
          addedAt: byId.get(stableId)?.addedAt || now,
          syncedAt: now,
          assetSha256: asset.hash,
          duplicateAsset: Boolean(duplicateOf && duplicateOf !== stableId),
          duplicateOf: duplicateOf && duplicateOf !== stableId ? duplicateOf : null
        });
        byHash.set(asset.hash, stableId);
        console.log(`[${source.label}] ${detail.name} -> ${asset.format}${asset.animated ? ' animated' : ''}`);
      } catch (error) {
        console.warn(`[${source.label}] skipped ${detailUrl}: ${error.message}`);
      } finally {
        await page.close();
      }
    }, concurrency);
  }
} finally {
  await browser.close();
}

const all = [...byId.values()].sort((a, b) => {
  const community = Number(['slackmojis', 'discadia'].includes(b.source)) - Number(['slackmojis', 'discadia'].includes(a.source));
  if (community) return community;
  const animated = Number(Boolean(b.animated)) - Number(Boolean(a.animated));
  if (animated) return animated;
  return String(a.name).localeCompare(String(b.name));
});

await writeJson(DATA_FILE, all);
await writeJson(API_FILE, all);
await writeJson(STATE_FILE, state);
console.log(`\nDone. ${all.length} total emoji records indexed.`);
