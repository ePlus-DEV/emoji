import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectImageAsset,
  isCandidateAssetUrl,
  validateImageAsset
} from '../scripts/lib/emojigg-asset.mjs';

test('detectImageAsset identifies supported raster formats by magic bytes', () => {
  assert.deepEqual(
    detectImageAsset(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
    { ext: '.gif', format: 'gif', animated: true }
  );

  assert.deepEqual(
    detectImageAsset(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
    { ext: '.png', format: 'png', animated: false }
  );

  assert.deepEqual(
    detectImageAsset(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])),
    { ext: '.jpg', format: 'jpg', animated: false }
  );

  assert.deepEqual(
    detectImageAsset(Buffer.from('RIFFxxxxWEBPVP8 ', 'ascii')),
    { ext: '.webp', format: 'webp', animated: false }
  );

  assert.deepEqual(
    detectImageAsset(Buffer.from('RIFFxxxxWEBPVP8XxxxxANIM', 'ascii')),
    { ext: '.webp', format: 'webp', animated: true }
  );
});

test('validateImageAsset rejects HTML returned from an image-looking URL', () => {
  const html = Buffer.from('<!DOCTYPE html><html><head><title>Emoji.gg</title></head></html>');

  assert.throws(
    () => validateImageAsset(html, 'text/html; charset=UTF-8', 'https://emoji.gg/cdn/emoji/pepes.png'),
    /returned HTML instead of an image/
  );
});

test('validateImageAsset rejects HTML even when the server lies with image/png', () => {
  const html = Buffer.from('<html><body>redirect page</body></html>');

  assert.throws(
    () => validateImageAsset(html, 'image/png', 'https://emoji.gg/emoji/223113-pepes.png'),
    /body is not a supported image/
  );
});

test('validateImageAsset accepts a valid image with a matching content type', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  assert.deepEqual(
    validateImageAsset(png, 'image/png', 'https://cdn.example.com/emoji.png'),
    { ext: '.png', format: 'png', animated: false }
  );
});

test('isCandidateAssetUrl filters obvious site chrome and non-image URLs', () => {
  assert.equal(isCandidateAssetUrl('https://cdn.example.com/emojis/pepe.gif'), true);
  assert.equal(isCandidateAssetUrl('https://emoji.gg/assets/img/logo.png'), false);
  assert.equal(isCandidateAssetUrl('https://emoji.gg/assets/banner.webp'), false);
  assert.equal(isCandidateAssetUrl('https://emoji.gg/emoji/223113-pepes'), false);
});
