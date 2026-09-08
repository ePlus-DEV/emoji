import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_FILE = path.resolve('src/data/emojis.json');
const API_FILE = path.resolve('public/api/emojis.json');
const OUT_DIR = path.resolve('public/emojis/noto-animated');
const LIMIT = Math.max(8, Number.parseInt(process.env.ANIMATED_LIMIT || '32', 10) || 32);
const CONCURRENCY = 6;
const API_URL = 'https://googlefonts.github.io/noto-emoji-animation/data/api.json';

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function cleanTag(tag) {
  return String(tag || '').replace(/^:|:$/g, '').trim();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'eplus-emoji-pages' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'eplus-emoji-pages' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function pool(items, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
}

const payload = await fetchJson(API_URL);
const icons = Array.isArray(payload.icons) ? payload.icons : [];
const selected = icons.slice(0, LIMIT);
const existing = JSON.parse(await readFile(DATA_FILE, 'utf8'));
const byId = new Map(existing.map((emoji) => [emoji.id, emoji]));

await mkdir(OUT_DIR, { recursive: true });
let synced = 0;

await pool(selected, async (icon) => {
  const codepoint = String(icon.codepoint || '').toLowerCase();
  if (!codepoint) return;

  const tags = Array.isArray(icon.tags) ? icon.tags.map(cleanTag).filter(Boolean) : [];
  const name = tags[0] || `animated-${codepoint}`;
  const shortcode = slugify(name).replaceAll('-', '_') || codepoint.replaceAll('-', '_');
  const filename = `${codepoint}.gif`;
  const assetUrl = `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}/512.gif`;

  try {
    const bytes = await fetchBuffer(assetUrl);
    if (bytes.length < 32 || bytes.subarray(0, 3).toString('ascii') !== 'GIF') {
      throw new Error('response is not a GIF');
    }

    await writeFile(path.join(OUT_DIR, filename), bytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const id = `noto-animated-${codepoint}`;

    byId.set(id, {
      id,
      slug: `noto-animated-${slugify(name)}-${codepoint}`,
      name: name.replace(/\b\w/g, (letter) => letter.toUpperCase()),
      shortcode,
      emoji: '',
      hexcode: codepoint.toUpperCase(),
      group: 'animated',
      subgroup: 'noto-animated',
      tags: [...new Set(['animated', 'gif', 'reaction', ...tags])].slice(0, 24),
      source: 'noto-animated',
      sourceLabel: 'Noto Animated',
      sourceUrl: 'https://googlefonts.github.io/noto-emoji-animation/',
      image: `/emojis/noto-animated/${filename}`,
      format: 'gif',
      animated: true,
      license: 'CC-BY-4.0',
      attribution: 'Google Noto Animated Emoji',
      addedAt: new Date().toISOString().slice(0, 10),
      assetSha256: hash,
      duplicateAsset: false
    });
    synced += 1;
  } catch (error) {
    console.warn(`[Noto Animated] skipped ${codepoint}: ${error.message}`);
  }
});

const all = [...byId.values()].sort((a, b) => {
  const animated = Number(Boolean(b.animated)) - Number(Boolean(a.animated));
  if (animated) return animated;
  const date = String(b.addedAt).localeCompare(String(a.addedAt));
  return date || String(a.name).localeCompare(String(b.name));
});

const json = `${JSON.stringify(all, null, 2)}\n`;
await writeFile(DATA_FILE, json);
await mkdir(path.dirname(API_FILE), { recursive: true });
await writeFile(API_FILE, json);

console.log(`Synced ${synced} animated GIF emoji. ${all.length} total records available to the Pages build.`);
