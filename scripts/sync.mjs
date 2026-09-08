import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SOURCES } from './lib/sources.mjs';

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const pair = args.find((arg) => arg.startsWith(`--${name}=`));
  if (pair) return pair.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const requestedSource = valueFor('source', 'all');
const limit = Number.parseInt(valueFor('limit', '200'), 10);
const concurrency = Math.max(1, Number.parseInt(valueFor('concurrency', '12'), 10) || 12);
const token = process.env.GITHUB_TOKEN || '';
const headers = token
  ? { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'eplus-emoji-sync' }
  : { Accept: 'application/vnd.github+json', 'User-Agent': 'eplus-emoji-sync' };

const DATA_FILE = path.resolve('src/data/emojis.json');
const API_FILE = path.resolve('public/api/emojis.json');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function shortcodeFor(annotation, hexcode) {
  return slugify(annotation).replaceAll('-', '_') || hexcode.toLowerCase().replaceAll('-', '_');
}

function twemojiFilename(hexcode) {
  return `${hexcode
    .split('-')
    .filter((part) => part.toUpperCase() !== 'FE0F')
    .map((part) => part.toLowerCase().replace(/^0+/, '') || '0')
    .join('-')}.svg`;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

async function fetchTree(source) {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${source.branch}?recursive=1`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const payload = await response.json();
  if (payload.truncated) console.warn(`[${source.id}] Git tree response was truncated.`);
  return new Set(
    payload.tree
      .filter((entry) => entry.type === 'blob' && entry.path.startsWith(source.assetPrefix) && entry.path.endsWith('.svg'))
      .map((entry) => entry.path.slice(source.assetPrefix.length))
  );
}

async function runPool(items, worker, size) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

const metadataCsv = await fetchText('https://raw.githubusercontent.com/hfg-gmuend/openmoji/master/data/openmoji.csv');
const metadata = parseCsv(metadataCsv);
const existing = JSON.parse(await readFile(DATA_FILE, 'utf8'));
const byId = new Map(existing.map((emoji) => [emoji.id, emoji]));
const hashes = new Set(existing.map((emoji) => emoji.assetSha256).filter(Boolean));

const selectedSources = requestedSource === 'all'
  ? Object.values(SOURCES)
  : [SOURCES[requestedSource]].filter(Boolean);

if (!selectedSources.length) {
  throw new Error(`Unknown source: ${requestedSource}. Available: ${Object.keys(SOURCES).join(', ')}, all`);
}

for (const source of selectedSources) {
  console.log(`\n[${source.label}] reading upstream tree...`);
  const upstreamFiles = source.id === 'openmoji' ? null : await fetchTree(source);
  let candidates = metadata.filter((item) => {
    const filename = source.id === 'twemoji' ? twemojiFilename(item.hexcode) : `${item.hexcode}.svg`;
    const id = `${source.id}-${item.hexcode.toLowerCase()}`;
    const current = byId.get(id);
    const available = upstreamFiles ? upstreamFiles.has(filename) : true;
    return available && (!current || current.image.startsWith('http'));
  });

  // Always localize existing hotlinked records before spending the limit on new emoji.
  candidates.sort((a, b) => {
    const aCurrent = byId.get(`${source.id}-${a.hexcode.toLowerCase()}`);
    const bCurrent = byId.get(`${source.id}-${b.hexcode.toLowerCase()}`);
    const aHotlinked = aCurrent?.image?.startsWith('http') ? 1 : 0;
    const bHotlinked = bCurrent?.image?.startsWith('http') ? 1 : 0;
    return bHotlinked - aHotlinked;
  });

  if (Number.isFinite(limit) && limit > 0) candidates = candidates.slice(0, limit);
  console.log(`[${source.label}] ${candidates.length} new/localized assets selected.`);

  await runPool(candidates, async (item) => {
    try {
      const filename = source.id === 'twemoji' ? twemojiFilename(item.hexcode) : `${item.hexcode}.svg`;
      const rawUrl = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/${source.assetPrefix}${filename}`;
      const svg = await fetchText(rawUrl);
      const hash = createHash('sha256').update(svg).digest('hex');
      const outputDir = path.resolve('public/emojis', source.id);
      await mkdir(outputDir, { recursive: true });
      await writeFile(path.join(outputDir, filename), svg);

      const id = `${source.id}-${item.hexcode.toLowerCase()}`;
      const annotation = item.annotation || item.hexcode;
      const tags = [...new Set([
        ...String(item.tags || '').split(',').map((tag) => tag.trim()),
        ...String(item.openmoji_tags || '').split(',').map((tag) => tag.trim())
      ].filter(Boolean))].slice(0, 24);

      const record = {
        id,
        slug: `${source.id}-${slugify(annotation)}-${item.hexcode.toLowerCase()}`,
        name: annotation.replace(/\b\w/g, (letter) => letter.toUpperCase()),
        shortcode: shortcodeFor(annotation, item.hexcode),
        emoji: item.emoji,
        hexcode: item.hexcode,
        group: item.group || 'other',
        subgroup: item.subgroups || 'other',
        tags,
        source: source.id,
        sourceLabel: source.label,
        sourceUrl: source.id === 'openmoji'
          ? `https://openmoji.org/library/emoji-${item.hexcode}/`
          : source.homepage,
        image: `/emojis/${source.id}/${filename}`,
        format: 'svg',
        animated: false,
        license: source.license,
        attribution: source.id === 'openmoji'
          ? [item.openmoji_author, 'OpenMoji'].filter(Boolean).join(' / ')
          : 'Twemoji contributors',
        addedAt: item.openmoji_date || new Date().toISOString().slice(0, 10),
        assetSha256: hash,
        duplicateAsset: hashes.has(hash)
      };

      hashes.add(hash);
      byId.set(id, record);
    } catch (error) {
      console.warn(`[${source.label}] skipped ${item.hexcode}: ${error.message}`);
    }
  }, concurrency);
}

const all = [...byId.values()].sort((a, b) => {
  const date = String(b.addedAt).localeCompare(String(a.addedAt));
  return date || a.name.localeCompare(b.name) || a.source.localeCompare(b.source);
});

const json = `${JSON.stringify(all, null, 2)}\n`;
await writeFile(DATA_FILE, json);
await mkdir(path.dirname(API_FILE), { recursive: true });
await writeFile(API_FILE, json);
console.log(`\nDone. ${all.length} emoji variants indexed.`);
