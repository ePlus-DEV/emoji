const HOME = 'https://discords.com';
const EMOJI_LIST = `${HOME}/emoji-list`;
const TAG_PATTERN = /^\/emoji-list\/tag\/([^/?#]+)\/?$/i;
const CDN_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const EMOJI_ASSET_PATTERN = /^\/emojis\/(\d+)\.(png|gif|webp|jpe?g)$/i;

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function titleize(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function discordsTagUrl(tag = 'home') {
  const normalized = String(tag || 'home').trim();
  if (!normalized || /^(?:home|trending)$/i.test(normalized)) return EMOJI_LIST;
  return `${EMOJI_LIST}/tag/${encodeURIComponent(normalized)}`;
}

export function discordsTagInfo(value) {
  try {
    const url = new URL(value, HOME);
    if (url.hostname !== 'discords.com' && url.hostname !== 'www.discords.com') return null;
    const match = url.pathname.match(TAG_PATTERN);
    if (!match) return null;
    const decoded = decodeURIComponent(match[1]);
    return {
      slug: slugify(decoded) || decoded.toLowerCase(),
      name: titleize(decoded),
      url: `${EMOJI_LIST}/tag/${encodeURIComponent(decoded)}`
    };
  } catch {
    return null;
  }
}

export function discordEmojiAssetInfo(value, label = '', pageUrl = EMOJI_LIST) {
  try {
    const url = new URL(value, pageUrl);
    if (!CDN_HOSTS.has(url.hostname)) return null;
    const match = url.pathname.match(EMOJI_ASSET_PATTERN);
    if (!match) return null;

    const cleanName = String(label || '')
      .replace(/^image:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      id: match[1],
      name: cleanName || `Discord Emoji ${match[1]}`,
      assetUrl: url.toString(),
      pageUrl: new URL(pageUrl, HOME).toString()
    };
  } catch {
    return null;
  }
}
