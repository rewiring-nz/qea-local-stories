# CLAUDE.md — notes for an AI agent working on this repo

Read `README.md` for setup and usage. This file covers the things that
aren't obvious from the code.

## What this is

An embeddable map plus filterable story list for QEA's Local Stories
page. Story data comes from a Webflow CMS Collection — no fetch, no API
key, no build step.

Sibling repos, same house style: `rewiring-nz/communities-map` and
`rewiring-nz/resilience-hubs-map`. Check those before re-solving a
shared problem.

## File relationships

- **`stories.js` / `stories.css` are the source of truth.** Edit these.
- `index.html` and `embed.html` load them as external files.
- **`webflow-embed.html` is generated.** Never hand-edit it. Run
  `./gen_embed.sh` after every change; it fails loudly if the export
  survives the transform. It is now ~55KB, past Webflow's 50,000
  character Embed limit, so it is kept for reference and for non-Webflow
  hosts — the site uses the iframe instead.
- `webflow-iframe-embed.html` is the Webflow side of the iframe embed.
  It is pasted into the site once and should stay stable — think hard
  before changing it, because changing it means someone has to paste.

## The one rule

`state = { type, tech, selectedId }` is the single source of truth.
Nothing outside `setState()` assigns to it, and every surface — list,
markers, popup, URL — is re-derived in `render()`.

**If you add a feature, add it to `render()`.** Never reach into the DOM
to "also" update something; that is how the list and map drift apart,
which is the bug this component exists to avoid. Likewise every
selection goes through `selectStory(slug)`.

## Two data sources, one shape

Stories come either from this document's CMS list (`readStories`) or,
when running in an iframe, from rows the parent page posts in. Both go
through `makeStories()`, so there is one definition of a story and one
place where slugs, coordinates and tag lists get cleaned up. Add fields
there, not in either caller.

## Non-obvious decisions

**Selection does NOT wait for `map.on('load')`.** MapLibre only fires
`load` once tiles settle, so an unreachable tile server can delay it
indefinitely. An earlier version queued selections until `load` and went
completely inert when tiles failed. Only `fitToVisible()` waits, with a
3-second timeout. Don't reintroduce a readiness gate on selection.

**The deep link must be read BEFORE the first `render()`,** because
`render()` calls `syncUrl()`, which clears `?story=` when nothing is
selected.

**One popup instance, reused.** `applyingPopup` guards the `close`
listener while content is swapped, because MapLibre removes a popup
internally when it is re-added.

**Markers are created once and never recreated.** Filtering toggles
`.is-hidden` and `tabIndex`.

**`.qea-marker` must never have `position` in CSS.** MapLibre's inline
transform has to win. (Same trap as the sibling repos.)

**Blank lat/lng means "no location", not `0, 0`.** A row with the fields
left empty lists without a marker instead of plotting in the Atlantic.

**Transposed lat/lng is recovered, loudly.** A latitude outside ±90
can't be a latitude, so when only the swapped pair is valid,
`resolveLatLng()` uses it and warns. The warning is the point — the row
should still be fixed at source.

**Tag spellings are folded, tag lists are not.** `canonicaliseTags()`
maps case variants onto one spelling ("solar" → "Solar") before anything
derives a chip or a filter. It normalises how a tag is written, not
which tags exist — it is not a whitelist, and a new tag still gets its
own chip.

**The technology attribute is `data-tech`.** `data-technologies` and
`data-technology` are also accepted. Keep all three.

**Filter chips are built from the data, not hardcoded.** The order lists
are a display preference; anything unrecognised is appended.

**Short scalars come from `data-*`; rich text and images come from child
elements.** Webflow can't bind those types to a custom attribute. Rich
text is injected as HTML; `data-*` values are escaped.

## Sizing

The component fills its container in both axes — the host sets the
height, not the CSS. `--qea-min-height` is only a floor for when no
ancestor declares a height, since `height: 100%` resolves to `auto`
there and would collapse the map to nothing.

`.qea-list` uses `flex: 1 1 0`, not `auto`: with `auto` the cards report
their full stacked height and push the whole component taller than its
box.

**Mobile deliberately opts out.** At 375px the filter chips wrap to
~280px; with a 340px map above them, a fixed height leaves the list a
sliver. On mobile the host's height is a minimum and the list runs down
the page.

A `ResizeObserver` calls `map.resize()`, because the container can
change size without a window resize firing.

## Testing

```bash
python3 -m http.server 8777
npm install playwright
node tests/browser-test.js
```

102 checks. Needs MapLibre reachable; if the CDN is blocked, vendor it
into `.testvendor/` and generate `test-harness.html` from `index.html`
(both gitignored). Tile servers being unreachable is fine — the suite is
designed to pass without a single tile loading.

Fixtures: `tests/cms-variants.html` (awkward CMS rows — keep it messy,
it exists to prove the component survives mess) and
`tests/iframe-parent.html` (the postMessage bridge).

## Palette and basemap

The colours are sampled from the live QEA Local Stories page, not chosen
— `#1e1e7f` page, `#262784` cards, `#ff527e` accent, `#3c3c90` tech
pills. Section [13] of the suite asserts them, so a drift fails rather
than quietly looking wrong on the site. Retune in the first block of
`stories.css`.

The basemap is a **vector** style (CARTO dark-matter, free, no key)
recoloured after load, not a raster one. That is deliberate: the design
has navy land under periwinkle water, and tinting a raster preserves the
tiles' own light/dark relationship — every dark raster basemap draws
water darker than land, which is backwards here. `recolourBasemap()`
works off layer type and id rather than a hardcoded layer list, so a
CARTO style update doesn't leave a stripe of someone else's grey across
the map.

This does make the style JSON a network dependency, where previously
everything was raster tiles that could all fail harmlessly. Section [14]
covers it: with CARTO blocked, stories still list, select and filter.

## Still to do

The story content in `index.html` is placeholder copy under real story
names. The live site reads from the CMS and ignores it.
