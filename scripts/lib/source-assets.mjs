function normalizedCodepoints(hexcode) {
  return String(hexcode || '')
    .split('-')
    .filter(Boolean)
    .filter((part) => part.toUpperCase() !== 'FE0F')
    .map((part) => part.toLowerCase().replace(/^0+/, '') || '0');
}

export function sourceFilename(source, hexcode) {
  switch (source.filenameStyle) {
    case 'twemoji':
      return `${normalizedCodepoints(hexcode).join('-')}.svg`;
    case 'noto':
      return `emoji_u${normalizedCodepoints(hexcode).join('_')}.svg`;
    case 'openmoji':
    default:
      return `${hexcode}.svg`;
  }
}

export function sourceAttribution(source, item = {}) {
  if (source.id === 'openmoji') {
    return [item.openmoji_author, source.attribution || source.label].filter(Boolean).join(' / ');
  }
  return source.attribution || source.label;
}
