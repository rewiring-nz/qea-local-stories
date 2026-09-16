# CLAUDE.md — orientation for an AI agent working on this repo

For setup and usage, read `README.md`. This file covers the non-obvious
decisions that aren't discoverable from the code alone.

## What this is

An embeddable map + filterable story list for QEA's Local Stories page.
Story data comes from a **Webflow CMS Collection List rendered into the
page DOM** and read at startup — no fetch, no API key, no build step.

Sibling repos, same house style: `rewiring-nz/communities-map` (the
Webflow CMS reading pattern) and `rewiring-nz/resilience-hubs-map`
(marker styling, mobile sizing). Check those before re-solving a shared
problem.

## File relationships

- **`stories.js` / `stories.css` are the source of truth.** Edit these.
- `index.html` and `embed.html` load them as external files — edits are
  picked up automatically.
- **`webflow-embed.html` is generated.** Never hand-edit it. Run
  `./gen_embed.sh` after every `stories.js` / `stories.css` change. The
  script strips the trailing `window.initQeaStoriesMap = ...; })();`
  export and closes the IIFE around a direct call instead; it fails loudly
  if that export survives.

## The one rule

`state = { type, tech, selectedId }` is the single source of truth.
Nothing outside `setState()` assigns to it, and every surface — list DOM,
marker classes, popup, URL — is re-derived in `render()`.

**If you add a feature, add it to `render()`.** Never reach into the DOM
to "also" update something; that is exactly how the list and map drift
apart, which is the bug this component was commissioned to eliminate.

Likewise, every selection path goes through `selectStory(slug)`. If you
add a new way to choose a story, wire it through that function rather than
writing a second path.

## Non-obvious decisions

**Selection deliberately does NOT wait for `map.on('load')`.** MapLibre
only fires `load` once tile sources settle, so an unreachable or slow tile
server can delay it indefinitely. An earlier version queued selections
until `load` and became completely inert when tiles failed — caught by the
test suite. Markers, popups and camera moves all work off the map's
transform, which exists from construction. Only `fitToVisible()` waits for
`load`, and even that has a 3-second timeout fallback. **Don't
reintroduce a readiness gate on the selection path.**

**The deep link must be read BEFORE the first `render()`.** `render()`
calls `syncUrl()`, which deletes `?story=` when nothing is selected. Read
it afterwards and it is always empty — deep links silently never work.
The `initialSlug` capture sits above `render()` for this reason.

**One popup instance for the whole component, reused.** Not one popup per
marker. `applyingPopup` guards the `close` listener while we swap content,
because MapLibre removes a popup internally when it is re-added, and that
internal close would otherwise clear the selection mid-set.

**Markers are created once and never recreated.** Filtering toggles
`.is-hidden` and `tabIndex`. Do not rebuild markers on filter change — a
recreated marker is how stale references get in.

**`.qea-marker` must never have `position` in CSS.** MapLibre applies an
inline transform to the marker element and its positioning must win.
(Same trap as the two sibling repos.)

**Blank lat/lng means "no location", not `0, 0`.** `isValidLatLng()`
rejects the origin explicitly, so an unfinished CMS row lists without a
marker instead of plotting in the Atlantic.

**Filter chips are built from the data, not hardcoded.** `collectValues()`
takes a preferred order and appends anything unrecognised. The whole point
is that QEA can add a category in Webflow without a code change — don't
reintroduce a fixed list.

**Short scalar fields come from `data-*`; rich text and images come from
child elements.** This is forced by Webflow: it cannot bind image or rich
text fields to a custom attribute. Rich text is injected as HTML (same
trust boundary as the page itself); everything from a `data-*` attribute
is escaped.

**Selecting a filtered-out story widens the filter** rather than failing
silently, so a deep link to a story always resolves.

## Testing

```bash
python3 -m http.server 8777
node tests/browser-test.js
```

47 checks. The suite needs MapLibre reachable; if the CDN is blocked,
vendor `maplibre-gl.js`/`.css` into `.testvendor/` from npm and generate
`test-harness.html` by rewriting the CDN URLs in `index.html` (both are
gitignored).

Tile servers being unreachable is fine — the suite is designed to pass
without a single tile loading, which is itself a useful property.

## Still unverified

The live QEA page was unreachable from the build environment, so the
visual design is a neutral approximation with the palette in CSS custom
properties at the top of `stories.css`. The story content in `index.html`
is placeholder copy under real story names. Neither affects behaviour —
the live site reads from the CMS — but don't mistake the demo content for
real QEA data.
