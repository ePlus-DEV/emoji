const HTML_CONTENT_TYPE = /(?:^|;)\s*(?:text\/html|application\/xhtml\+xml)\b/i;
const IMAGE_CONTENT_TYPE = /^image\/(?:gif|png|webp|jpe?g)\b/i;
const GENERIC_BINARY_CONTENT_TYPE = /^(?:application|binary)\/octet-stream\b/i;

function startsWith(buffer, bytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function isAnimatedWebP(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  return buffer.indexOf(Buffer.from('ANIM', 'ascii')) >= 0
    || buffer.indexOf(Buffer.from('ANMF', 'ascii')) >= 0;
}

export function detectImageAsset(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) {
    return { ext: '.gif', format: 'gif', animated: true };
  }

  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: '.webp', format: 'webp', animated: isAnimatedWebP(buffer) };
  }

  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: '.png', format: 'png', animated: false };
  }

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { ext: '.jpg', format: 'jpg', animated: false };
  }

  return null;
}

export function validateImageAsset(buffer, contentType = '', url = '') {
  const normalizedContentType = String(contentType || '').trim();

  if (HTML_CONTENT_TYPE.test(normalizedContentType)) {
    throw new Error(`asset returned HTML instead of an image${url ? `: ${url}` : ''}`);
  }

  const detected = detectImageAsset(buffer);
  if (!detected) {
    const typeHint = normalizedContentType || 'unknown content-type';
    throw new Error(`asset body is not a supported image (${typeHint})${url ? `: ${url}` : ''}`);
  }

  if (
    normalizedContentType
    && !IMAGE_CONTENT_TYPE.test(normalizedContentType)
    && !GENERIC_BINARY_CONTENT_TYPE.test(normalizedContentType)
  ) {
    throw new Error(`asset has unexpected content-type ${normalizedContentType}${url ? `: ${url}` : ''}`);
  }

  return detected;
}

export function isCandidateAssetUrl(value) {
  try {
    const parsed = new URL(value);
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    const searchable = `${parsed.hostname}${pathAndQuery}`.toLowerCase();

    return /\.(?:png|gif|webp|jpe?g)(?:\?|$)/i.test(pathAndQuery)
      && !/(?:^|[\/_-])(?:logo|avatar|favicon|banner)(?:[\/_-]|\.|$)|(?:^|\/)ads?(?:\/|$)/i.test(searchable);
  } catch {
    return false;
  }
}
