import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
// The site is deployed on the custom domain https://emoji.eplus.dev with Astro base '/'.
// Do not infer '/emoji' merely because the build runs inside GitHub Actions.
const base = (process.env.VERIFY_BASE ?? '').replace(/\/+$/g, '');
let errors = 0;
let checked = 0;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function cleanUrl(value) {
  return value.split('#')[0].split('?')[0];
}

function isExternal(value) {
  return /^(?:[a-z]+:)?\/\//i.test(value) || /^(?:mailto:|tel:|data:|javascript:|#)/i.test(value);
}

const htmlFiles = (await walk(dist)).filter((file) => file.endsWith('.html'));

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const attrs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);

  for (const raw of attrs) {
    if (!raw || isExternal(raw)) continue;
    const url = cleanUrl(raw);
    if (!url.startsWith('/')) continue;
    checked += 1;

    if (base && url !== base && !url.startsWith(`${base}/`)) {
      console.error(`[bad base] ${path.relative(dist, file)} -> ${url}`);
      errors += 1;
      continue;
    }

    let relative = base && url.startsWith(base) ? url.slice(base.length) : url;
    relative = relative.replace(/^\//, '');

    if (!relative) {
      if (!await exists(path.join(dist, 'index.html'))) {
        console.error(`[missing target] ${url}`);
        errors += 1;
      }
      continue;
    }

    const direct = path.join(dist, relative);
    const routeIndex = path.join(dist, relative, 'index.html');
    const routeHtml = path.join(dist, `${relative}.html`);

    if (!await exists(direct) && !await exists(routeIndex) && !await exists(routeHtml)) {
      console.error(`[missing target] ${path.relative(dist, file)} -> ${url}`);
      errors += 1;
    }
  }
}

if (errors) {
  console.error(`\nBuild verification failed with ${errors} broken internal URL(s).`);
  process.exit(1);
}

console.log(`Verified ${checked} internal URLs across ${htmlFiles.length} HTML pages.`);
