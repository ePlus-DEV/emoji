import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SLACKMOJIS_JSON_URL,
  slackmojisDetailInfo,
  slackmojisRecordInfo,
  selectSlackmojisRecords
} from '../scripts/lib/slackmojis.mjs';

test('uses the public Slackmojis JSON catalog endpoint', () => {
  assert.equal(SLACKMOJIS_JSON_URL, 'https://slackmojis.com/emojis.json');
});

test('parses Slackmojis detail URLs', () => {
  assert.deepEqual(
    slackmojisDetailInfo('https://slackmojis.com/emojis/8904-calculate'),
    {
      id: '8904',
      slug: 'calculate',
      url: 'https://slackmojis.com/emojis/8904-calculate'
    }
  );
  assert.equal(slackmojisDetailInfo('https://slackmojis.com/emojis/recent'), null);
});

test('normalizes a Slackmojis JSON record', () => {
  assert.deepEqual(
    slackmojisRecordInfo({
      id: 512,
      name: 'disco',
      credit: 'st3ve',
      created_at: '2016-06-15T14:06:53.016Z',
      updated_at: '2024-03-28T02:54:39.272Z',
      image_url: 'https://emojis.slackmojis.com/emojis/images/1643514093/512/disco.gif?1643514093',
      category: { id: 19, name: 'Random' }
    }),
    {
      id: '512',
      name: 'disco',
      slug: 'disco',
      shortcode: 'disco',
      credit: 'st3ve',
      createdAt: '2016-06-15T14:06:53.016Z',
      updatedAt: '2024-03-28T02:54:39.272Z',
      imageUrl: 'https://emojis.slackmojis.com/emojis/images/1643514093/512/disco.gif?1643514093',
      categoryId: '19',
      categoryName: 'Random',
      categorySlug: 'random',
      url: 'https://slackmojis.com/emojis/512-disco'
    }
  );
});

test('recent mode sorts JSON records by created_at descending', () => {
  const records = [
    { id: 1, name: 'old', created_at: '2020-01-01T00:00:00Z', image_url: 'https://example.com/old.png' },
    { id: 2, name: 'new', created_at: '2025-01-01T00:00:00Z', image_url: 'https://example.com/new.png' }
  ];
  assert.deepEqual(selectSlackmojisRecords(records, 'recent').map((item) => item.id), ['2', '1']);
  assert.throws(() => selectSlackmojisRecords(records, 'popular'), /Unknown Slackmojis mode/);
});
