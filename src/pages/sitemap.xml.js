import emojis from '../data/emojis.json';

export const prerender = true;

const SITE = 'https://emoji.eplus.dev';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function dateOnly(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || '';
}

function urlEntry({ loc, lastmod = '', changefreq = '', priority = '' }) {
  return [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : '',
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : '',
    priority ? `    <priority>${priority}</priority>` : '',
    '  </url>'
  ].filter(Boolean).join('\n');
}

export function GET() {
  const entries = [
    { loc: `${SITE}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${SITE}/emojis`, changefreq: 'daily', priority: '0.9' },
    { loc: `${SITE}/api/emojis.json`, changefreq: 'daily', priority: '0.6' },
    { loc: `${SITE}/api/categories.json`, changefreq: 'daily', priority: '0.5' },
    { loc: `${SITE}/llms.txt`, changefreq: 'weekly', priority: '0.4' },
    { loc: `${SITE}/agents.md`, changefreq: 'weekly', priority: '0.4' },
    ...emojis.map((emoji) => ({
      loc: `${SITE}/emoji/${encodeURIComponent(emoji.slug)}`,
      lastmod: dateOnly(emoji.syncedAt || emoji.addedAt),
      changefreq: 'monthly',
      priority: '0.7'
    }))
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(urlEntry),
    '</urlset>',
    ''
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
