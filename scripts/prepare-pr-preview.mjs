import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
const base = String(process.env.PR_PREVIEW_BASE || process.argv[2] || '/')
  .replace(/^\/+|\/+$/g, '');
const publicBase = base ? `/${base}/` : '/';

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

const htmlFiles = (await walk(dist)).filter((file) => file.endsWith('.html'));
const routeMap = new Map();

for (const file of htmlFiles) {
  const relative = path.relative(dist, file).split(path.sep).join('/');
  if (relative === 'index.html') {
    routeMap.set(publicBase, `${publicBase}index.html`);
    routeMap.set(publicBase.replace(/\/$/, ''), `${publicBase}index.html`);
    continue;
  }

  if (!relative.endsWith('/index.html')) continue;
  const route = relative.slice(0, -'/index.html'.length);
  routeMap.set(`${publicBase}${route}`, `${publicBase}${route}/index.html`);
  routeMap.set(`${publicBase}${route}/`, `${publicBase}${route}/index.html`);
}

function rewriteUrl(value) {
  if (!value.startsWith('/')) return value;

  const splitAt = value.search(/[?#]/);
  const pathname = splitAt === -1 ? value : value.slice(0, splitAt);
  const suffix = splitAt === -1 ? '' : value.slice(splitAt);
  const mapped = routeMap.get(pathname);
  return mapped ? `${mapped}${suffix}` : value;
}

let rewrites = 0;
for (const file of htmlFiles) {
  const original = await readFile(file, 'utf8');
  const updated = original.replace(/\b(href|action)=(['"])(.*?)\2/g, (match, attr, quote, value) => {
    const next = rewriteUrl(value);
    if (next === value) return match;
    rewrites += 1;
    return `${attr}=${quote}${next}${quote}`;
  });

  if (updated !== original) await writeFile(file, updated);
}

console.log(`Prepared ${htmlFiles.length} HTML files for static PR preview; rewrote ${rewrites} route link(s).`);
