import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const emojis = JSON.parse(await readFile('src/data/emojis.json', 'utf8'));
const ids = new Set();
const slugs = new Set();
let errors = 0;

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

  if (!emoji.image.startsWith('http')) {
    const localPath = path.resolve('public', emoji.image.replace(/^\//, ''));
    try {
      await access(localPath);
    } catch {
      console.error(`[missing asset] ${emoji.id}: ${localPath}`);
      errors += 1;
    }
  }
}

if (errors) {
  console.error(`\nData verification failed with ${errors} error(s).`);
  process.exit(1);
}
console.log(`Verified ${emojis.length} emoji records.`);
