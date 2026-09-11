const HOME = 'https://slackmojis.com';
export const SLACKMOJIS_JSON_URL = `${HOME}/emojis.json`;
const DETAIL_PATTERN = /^\/emojis\/(\d+)-([^/?#]+)\/?$/i;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function slackmojisDetailInfo(value) {
  try {
    const url = new URL(value, HOME);
    if (url.hostname !== 'slackmojis.com' && url.hostname !== 'www.slackmojis.com') return null;
    const match = url.pathname.match(DETAIL_PATTERN);
    if (!match) return null;
    return {
      id: match[1],
      slug: match[2],
      url: `${HOME}/emojis/${match[1]}-${match[2]}`
    };
  } catch {
    return null;
  }
}

export function slackmojisRecordInfo(record) {
  const id = String(record?.id ?? '').trim();
  const name = String(record?.name ?? '').trim();
  const imageUrl = String(record?.image_url ?? '').trim();
  if (!id || !/^\d+$/.test(id) || !name || !imageUrl) return null;

  try {
    const image = new URL(imageUrl);
    if (image.protocol !== 'https:' && image.protocol !== 'http:') return null;
  } catch {
    return null;
  }

  const slug = slugify(name) || `emoji-${id}`;
  const categoryName = String(record?.category?.name ?? 'Community').trim() || 'Community';
  const categoryId = String(record?.category?.id ?? '').trim();

  return {
    id,
    name,
    slug,
    shortcode: slug.replaceAll('-', '_'),
    credit: String(record?.credit ?? '').trim(),
    createdAt: String(record?.created_at ?? '').trim(),
    updatedAt: String(record?.updated_at ?? '').trim(),
    imageUrl,
    categoryId,
    categoryName,
    categorySlug: slugify(categoryName) || 'community',
    url: `${HOME}/emojis/${id}-${slug}`
  };
}

export function selectSlackmojisRecords(records, mode = 'recent') {
  const normalized = String(mode || 'recent').trim().toLowerCase();
  if (!['recent', 'all'].includes(normalized)) {
    throw new Error(`Unknown Slackmojis mode: ${mode}. Available: recent, all`);
  }

  const items = (Array.isArray(records) ? records : [])
    .map(slackmojisRecordInfo)
    .filter(Boolean);

  if (normalized === 'recent') {
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || Number(b.id) - Number(a.id));
  }

  return items;
}
