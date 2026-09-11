import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateImageAsset } from './lib/emojigg-asset.mjs';
import {
  SLACKMOJIS_JSON_URL,
  selectSlackmojisRecords
} from './lib/slackmojis.mjs';

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const pair = args.find((arg) => arg.startsWith(`--${name}=`));
  if (pair) return pair.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const mode = String(valueFor('mode', valueFor('collection', 'recent'))).trim().toLowerCase();
const rawLimit = Number.parseInt(valueFor('limit', '200'), 10);
const limit = Number.isFinite(rawLimit) ? Math.max(0, rawLimit) : 200;
const concurrency = Math.max(1, Math.min(12, Number.parseInt(valueFor('concurrency', '6'), 10) || 6));
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

async function fetchCatalog() {
  const response = await fetch(SLACKMOJIS_JSON_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 VietnamAwesomeEmojiBot/1.0'
    }
  });
  if (!response.ok) throw new Error(`Slackmojis catalog returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('Slackmojis emojis.json did not return an array');
  return selectSlackmojisRecords(payload, mode);
}

async function downloadAsset(item) {
  const response = await fetch(item.imageUrl, {
    headers: {
      Referer: item.url,
      'User-Agent': 'Mozilla/5.0 VietnamAwesomeEmojiBot/1.0'
    },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > maxBytes) throw new Error(`size ${buffer.length} is invalid`);
  const contentType = response.headers.get('content-type') || '';
  const detected = validateImageAsset(buffer, contentType, item.imageUrl);

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

const catalog = await fetchCatalog();
const missing = catalog.filter((item) => !byId.has(`slackmojis-${item.id}`));
const chosen = limit === 0 ? missing : missing.slice(0, limit);
let imported = 0;
let failed = 0;

console.log(`[${SOURCE.label}] endpoint=${SLACKMOJIS_JSON_URL}`);
console.log(`[${SOURCE.label}] catalog=${catalog.length}, missing=${missing.length}, selected=${chosen.length}, mode=${mode}`);

await runPool(chosen, async (item, index) => {
  try {
    const asset = await downloadAsset(item);
    const now = new Date().toISOString();
    const id = `slackmojis-${item.id}`;
    const current = byId.get(id);
    const duplicateId = byHash.get(asset.hash);

    const record = {
      id,
      slug: `slackmojis-${item.slug}-${item.id}`,
      name: item.name,
      shortcode: item.shortcode,
      group: 'community',
      subgroup: `slackmojis-${item.categorySlug}`,
      category: item.categoryName,
      categorySlug: item.categorySlug,
      categoryId: item.categoryId || undefined,
      tags: [...new Set(['slackmojis', 'custom-emoji', item.categorySlug, asset.animated ? 'animated' : 'static'].filter(Boolean))],
      source: SOURCE.id,
      sourceLabel: SOURCE.label,
      sourceUrl: item.url,
      upstreamAssetUrl: item.imageUrl,
      image: asset.image,
      format: asset.format,
      animated: asset.animated,
      license: 'Source terms / rights vary',
      attribution: item.credit ? `Slackmojis / ${item.credit}` : 'Slackmojis / original contributor',
      addedAt: current?.addedAt || item.createdAt?.slice(0, 10) || now.slice(0, 10),
      syncedAt: now,
      assetSha256: asset.hash,
      duplicateAsset: Boolean(duplicateId && duplicateId !== id)
    };

    byId.set(id, record);
    if (!byHash.has(asset.hash)) byHash.set(asset.hash, id);
    imported += 1;
    console.log(`[${SOURCE.label}] ${index + 1}/${chosen.length} imported ${record.shortcode}${record.duplicateAsset ? ` (duplicate of ${duplicateId})` : ''}`);
  } catch (error) {
    failed += 1;
    console.warn(`[${SOURCE.label}] ${item.imageUrl} skipped: ${error.message}`);
  }
}, concurrency);

state[SOURCE.id] = {
  mode,
  endpoint: SLACKMOJIS_JSON_URL,
  discovered: catalog.length,
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
