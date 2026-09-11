const HOME = 'https://slackmojis.com';
const DETAIL_PATTERN = /^\/emojis\/(\d+)-([^/?#]+)\/?$/i;

export const SLACKMOJIS_COLLECTIONS = {
  recent: `${HOME}/emojis/recent`,
  popular: `${HOME}/emojis/popular`,
  home: `${HOME}/emojis/`
};

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

export function slackmojisDownloadUrl(value) {
  const detail = slackmojisDetailInfo(value);
  return detail ? `${detail.url}/download` : '';
}

export function slackmojisCollectionUrls(collection = 'recent') {
  const normalized = String(collection || 'recent').trim().toLowerCase();
  if (normalized === 'all') return Object.values(SLACKMOJIS_COLLECTIONS);
  const url = SLACKMOJIS_COLLECTIONS[normalized];
  if (!url) {
    throw new Error(`Unknown Slackmojis collection: ${collection}. Available: ${Object.keys(SLACKMOJIS_COLLECTIONS).join(', ')}, all`);
  }
  return [url];
}
