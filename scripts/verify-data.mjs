import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const emojis = JSON.parse(await readFile('src/data/emojis.json', 'utf8'));
const ids = new Set();
const slugs = new Set();
let errors = 0;

function twemojiFilename(hexcode) {
  return `${hexcode
    .split('-')
    .filter((part) => part.toUpperCase() !== 'FE0F')
    .map((part) => part.toLowerCase().replace(/^0+/, '') || '0')
    .join('-')}.svg`;
}

function localImagePath(emoji) {
  if (emoji.image.startsWith('/emojis/')) return emoji.image;
  if (emoji.source === 'openmoji') return `/emojis/openmoji/${emoji.hexcode}.svg`;
  if (emoji.source === 'twemoji') return `/emojis/twemoji/${twemojiFilename(emoji.hexcode)}`;
  return null;
}

for (const emoji of emojis) {
  for (const field of ['id', 'slug', 'name', 'shortcode', 'image', 'source', 'license']) {
    if (!emoji[field]) {
      console.error(`[missing] ${emoji.id || '(unknown)'}: ${field}`);
      errors += 1;
    }
  }
  if (ids.has(emoji.id)) {
    console.error(`[duplicate id] ${emoji.id}`);
    errors += 1;
  }
  if (slugs.has(emoji.slug)) {
    console.error(`[duplicate slug] ${emoji.slug}`);
    errors += 1;
  }
  ids.add(emoji.id);
  slugs.add(emoji.slug);

  const image = localImagePath(emoji);
  if (!image) {
    console.error(`[external asset not supported] ${emoji.id}: ${emoji.image}`);
    errors += 1;
    continue;
  }

  const localPath = path.resolve('public', image.replace(/^\//, ''));
  try {
    await access(localPath);
  } catch {
    console.error(`[missing local asset] ${emoji.id}: ${localPath}`);
    errors += 1;
  }
}

if (errors) {
  console.error(`\nData verification failed with ${errors} error(s).`);
  process.exit(1);
}
console.log(`Verified ${emojis.length} emoji records and local assets.`);
