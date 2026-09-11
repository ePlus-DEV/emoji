import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SLACKMOJIS_COLLECTIONS,
  slackmojisCollectionUrls,
  slackmojisDetailInfo,
  slackmojisDownloadUrl
} from '../scripts/lib/slackmojis.mjs';

test('parses Slackmojis detail URLs', () => {
  assert.deepEqual(
    slackmojisDetailInfo('https://slackmojis.com/emojis/8904-calculate'),
    {
      id: '8904',
      slug: 'calculate',
      url: 'https://slackmojis.com/emojis/8904-calculate'
    }
  );
  assert.deepEqual(
    slackmojisDetailInfo('/emojis/123912-slackmojis/'),
    {
      id: '123912',
      slug: 'slackmojis',
      url: 'https://slackmojis.com/emojis/123912-slackmojis'
    }
  );
});

test('rejects collection and external URLs as detail pages', () => {
  assert.equal(slackmojisDetailInfo('https://slackmojis.com/emojis/recent'), null);
  assert.equal(slackmojisDetailInfo('https://example.com/emojis/8904-calculate'), null);
});

test('builds direct download URL from a detail page', () => {
  assert.equal(
    slackmojisDownloadUrl('https://slackmojis.com/emojis/8904-calculate'),
    'https://slackmojis.com/emojis/8904-calculate/download'
  );
});

test('resolves supported collection modes', () => {
  assert.deepEqual(slackmojisCollectionUrls('recent'), [SLACKMOJIS_COLLECTIONS.recent]);
  assert.deepEqual(slackmojisCollectionUrls('all'), [
    SLACKMOJIS_COLLECTIONS.recent,
    SLACKMOJIS_COLLECTIONS.popular,
    SLACKMOJIS_COLLECTIONS.home
  ]);
  assert.throws(() => slackmojisCollectionUrls('unknown'), /Unknown Slackmojis collection/);
});
