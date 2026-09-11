# 😀 ePlus Emoji

An open, searchable emoji directory for developers and communities, inspired by the browsing experience of Slackmojis and Discadia while keeping source and license metadata first-class.

## Features

- Fast static site built with Astro.
- Search by name, shortcode, tag, category or source.
- Copy Slack/Discord-style shortcodes in one click.
- Individual emoji pages with download, source, license and attribution.
- Public JSON index at `/api/emojis.json`.
- Automated importers for upstream Unicode sources and selected custom-emoji directories.
- SHA-256 metadata for exact duplicate detection.
- GitHub Pages deployment workflow.
- Scheduled source sync workflows with configurable import limits.

## Current sources

| Source | Artwork license | Sync support |
| --- | --- | --- |
| OpenMoji | CC BY-SA 4.0 | Yes |
| Twemoji | CC BY 4.0 | Yes |
| Noto Emoji | OFL 1.1 | Yes |
| Emoji.gg | Per asset / source terms | Yes |
| Slackmojis | Source terms / rights vary | Yes |
| Community submissions | Per contribution | Planned / PR-based |

See [NOTICE.md](NOTICE.md) before redistributing artwork.

## Local development

```bash
npm install
npm run dev
```

Build and verify:

```bash
npm test
npm run check:data
npm run build
```

## Sync emoji assets

Import up to 200 new assets from each supported Unicode source:

```bash
npm run sync
```

Import 500 new OpenMoji assets:

```bash
npm run sync -- --source=openmoji --limit=500
```

Import 500 Noto Emoji assets:

```bash
npm run sync -- --source=noto --limit=500
```

Import every remaining supported Unicode asset:

```bash
npm run sync -- --source=all --limit=0
```

The sync script downloads SVG files into `public/emojis/<source>/`, merges metadata into `src/data/emojis.json`, and updates `public/api/emojis.json`. Existing local assets are skipped, so scheduled runs gradually fill the repository without re-downloading the same files.

## Import Slackmojis

Import up to 200 missing emoji from the recently-added collection:

```bash
npm run import:slackmojis -- --collection=recent --limit=200
```

Available collection modes are `recent`, `popular`, `home`, and `all`. `all` combines the three public collection pages; it is not presented as a guaranteed exhaustive historical export.

The importer resolves each public detail page, requests its `/download` endpoint first, validates the downloaded bytes as a real PNG/GIF/WebP/JPEG before writing anything, stores files in `public/emojis/community/slackmojis/`, and deduplicates exact assets by SHA-256.

## Data schema

Each record contains fields such as:

```json
{
  "id": "openmoji-1f600",
  "slug": "openmoji-grinning-face-1f600",
  "name": "Grinning Face",
  "shortcode": "grinning_face",
  "emoji": "😀",
  "hexcode": "1F600",
  "group": "smileys-emotion",
  "tags": ["happy", "smile"],
  "source": "openmoji",
  "image": "/emojis/openmoji/1F600.svg",
  "license": "CC-BY-SA-4.0",
  "attribution": "OpenMoji"
}
```

## GitHub Pages

The website is configured to use the custom domain:

`https://emoji.eplus.dev`

After merging to `main`, enable **Settings → Pages → Source: GitHub Actions** if it is not already enabled. The `Deploy Pages` workflow will build and deploy the site.

## Adding another source

For upstream Unicode projects, prefer sources with an explicit redistribution license and add them through `scripts/lib/sources.mjs` plus `scripts/lib/source-assets.mjs`. Custom-directory importers should keep source URLs and rights metadata on every record and validate asset bytes before writing files.

## License

Repository code: MIT.

Emoji artwork: upstream licenses and source-specific terms; see [NOTICE.md](NOTICE.md).
