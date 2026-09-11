# ePlus Emoji Agent Guide

Canonical site: https://emoji.eplus.dev

## Purpose

ePlus Emoji is a searchable directory of static and animated emoji assets with source, attribution, license, category, and duplicate-detection metadata.

## Preferred machine-readable endpoints

- Full catalog: https://emoji.eplus.dev/api/emojis.json
- Category index: https://emoji.eplus.dev/api/categories.json
- Sitemap: https://emoji.eplus.dev/sitemap.xml
- LLM discovery summary: https://emoji.eplus.dev/llms.txt

## Recommended agent workflow

1. Read `/api/categories.json` when category-level discovery is needed.
2. Read `/api/emojis.json` and filter by fields such as `name`, `shortcode`, `tags`, `category`, `source`, `format`, or `animated`.
3. Open `/emoji/{slug}` when a human-readable detail page is useful.
4. Use the `image` value from the selected record to retrieve the hosted asset.
5. Preserve and surface `license`, `attribution`, and `sourceUrl` when presenting or redistributing an asset.

## Data notes

- `animated: true` identifies moving assets such as GIF/WebP records.
- `assetSha256` is used for exact duplicate detection when present.
- `duplicateAsset` and `duplicateOf` indicate known exact duplicates.
- `addedAt` records when an item first entered the local catalog.
- `syncedAt` records the latest local synchronization date when present.

## Crawling and freshness

The catalog is updated by automated source import workflows. Prefer the JSON endpoints for current structured data; the sitemap is regenerated from the same emoji index whenever the site is built.

## Rights and attribution

Artwork can come from multiple upstream sources and may have different licensing terms. Do not assume a single site-wide artwork license. Check each record's `license`, `attribution`, and `sourceUrl` before reuse.
