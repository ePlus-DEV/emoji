export interface EmojiAssetRef {
  image: string;
  source: string;
  hexcode: string;
}

function twemojiFilename(hexcode: string) {
  return `${hexcode
    .split('-')
    .filter((part) => part.toUpperCase() !== 'FE0F')
    .map((part) => part.toLowerCase().replace(/^0+/, '') || '0')
    .join('-')}.svg`;
}

export function localEmojiAssetPath(emoji: EmojiAssetRef) {
  if (emoji.image.startsWith('/emojis/')) return emoji.image;

  if (emoji.source === 'openmoji') {
    return `/emojis/openmoji/${emoji.hexcode}.svg`;
  }

  if (emoji.source === 'twemoji') {
    return `/emojis/twemoji/${twemojiFilename(emoji.hexcode)}`;
  }

  throw new Error(`External emoji asset is not allowed for source: ${emoji.source}`);
}

export function emojiAssetUrl(emoji: EmojiAssetRef, base: string) {
  const localPath = localEmojiAssetPath(emoji);
  return `${base}${localPath.replace(/^\//, '')}`;
}
