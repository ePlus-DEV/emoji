import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceAttribution, sourceFilename } from '../scripts/lib/source-assets.mjs';
import { SOURCES } from '../scripts/lib/sources.mjs';

test('OpenMoji keeps its uppercase hyphenated filename', () => {
  assert.equal(sourceFilename(SOURCES.openmoji, '1F468-200D-1F4BB'), '1F468-200D-1F4BB.svg');
});

test('Twemoji strips FE0F and uses lowercase hyphenated codepoints', () => {
  assert.equal(sourceFilename(SOURCES.twemoji, '2764-FE0F-200D-1F525'), '2764-200d-1f525.svg');
});

test('Noto Emoji strips FE0F and uses emoji_u underscore filenames', () => {
  assert.equal(sourceFilename(SOURCES.noto, '2764-FE0F-200D-1F525'), 'emoji_u2764_200d_1f525.svg');
  assert.equal(sourceFilename(SOURCES.noto, '1F600'), 'emoji_u1f600.svg');
});

test('source attribution is source-specific', () => {
  assert.equal(sourceAttribution(SOURCES.twemoji), 'Twemoji contributors');
  assert.equal(sourceAttribution(SOURCES.noto), 'Google / Noto Emoji contributors');
  assert.equal(
    sourceAttribution(SOURCES.openmoji, { openmoji_author: 'Example Artist' }),
    'Example Artist / OpenMoji'
  );
});
