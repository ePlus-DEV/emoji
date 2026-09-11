import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discordEmojiAssetInfo,
  discordsTagInfo,
  discordsTagUrl
} from '../scripts/lib/discords.mjs';

test('builds Discords.com emoji-list tag URLs', () => {
  assert.equal(discordsTagUrl('home'), 'https://discords.com/emoji-list');
  assert.equal(discordsTagUrl('Pepe'), 'https://discords.com/emoji-list/tag/Pepe');
});

test('parses Discords.com tag URLs', () => {
  assert.deepEqual(
    discordsTagInfo('https://discords.com/emoji-list/tag/Blob%20Cats'),
    {
      slug: 'blob-cats',
      name: 'Blob Cats',
      url: 'https://discords.com/emoji-list/tag/Blob%20Cats'
    }
  );
  assert.equal(discordsTagInfo('https://example.com/emoji-list/tag/Pepe'), null);
});

test('parses Discord CDN emoji assets and rejects unrelated images', () => {
  assert.deepEqual(
    discordEmojiAssetInfo(
      'https://cdn.discordapp.com/emojis/827581786673381389.webp?size=96',
      'pepe_cry',
      'https://discords.com/emoji-list/tag/Pepe'
    ),
    {
      id: '827581786673381389',
      name: 'pepe_cry',
      assetUrl: 'https://cdn.discordapp.com/emojis/827581786673381389.webp?size=96',
      pageUrl: 'https://discords.com/emoji-list/tag/Pepe'
    }
  );
  assert.equal(
    discordEmojiAssetInfo('https://cdn.discordapp.com/icons/123/avatar.png', 'avatar'),
    null
  );
});
