# QEA Local Stories — embeddable map component

An interactive map of QEA local stories, paired with a filterable,
scrollable story list. Desktop puts the map on the left and the list on
the right; mobile stacks the list underneath the map.

Story content comes from a **Webflow CMS Collection** — no story data is
hard-coded, and no JavaScript needs editing when the QEA team adds a
story.

- **No API keys.** Basemap tiles come from Esri's public raster service.
- **No build step.** Static files, served as-is.
- **No backend.** Webflow renders the CMS data into the page; the
  component reads it from the DOM.

---

## ⚠️ Read this first — two things need QEA input

This component was built from a written specification. The environment it
was developed in blocks all outbound web traffic, so **`qea.nz` could not
be inspected**. Two consequences:

1. **The visual design is a clean, neutral approximation**, not a match to
   the live QEA Local Stories page. Every colour, font and radius is a CSS
   custom property in the first 40 lines of `stories.css` — retuning to
   the real QEA palette is a one-block edit, not a rewrite.
2. **The story content in `index.html` is placeholder copy.** The story
   *names* are the real ones (Angela in Frankton, Ziptrek, Headwaters Eco
   Lodge, Queenstown Golf Club, Milford Infrastructure), but the
   descriptions, coordinates and body text are invented for development.
   They exist only so the demo harness has something to render — the live
   site reads from the CMS and ignores that block entirely.

Everything else — data flow, filtering, selection reliability, URL state,
accessibility, responsive behaviour — is complete and tested.

---

## Files

| File | Purpose |
|---|---|
| `stories.js` | The component. Edit this. |
| `stories.css` | All styling, with the brand palette at the top. Edit this. |
| `index.html` | Local development harness, with a stand-in CMS list. |
| `embed.html` | Bare, iframe-ready page (embedding Option A). |
| `webflow-embed.html` | **Generated** — CSS + JS inlined for a Webflow Embed (Option B). |
| `gen_embed.sh` | Regenerates `webflow-embed.html`. Run after every edit. |
| `tests/browser-test.js` | Playwright suite — 49 checks covering the brief's test list. |

`webflow-embed.html` is a build artifact. **Never hand-edit it** — change
`stories.js` / `stories.css` and run `./gen_embed.sh`.

---

## Webflow CMS setup

### 1. The Collection

Create a CMS Collection called **Local Stories**. Fields:

| Webflow field | Type | Required | Used for |
|---|---|---|---|
| Name | Plain text | ✅ | Story title, on the card and popup |
| Slug | Slug | ✅ (auto) | `?story=` deep link, and the internal story ID |
| Type | Option | ✅ | Type filter — *Households*, *Businesses*, *Community* |
| Technology | Multi-reference *or* Plain text | – | Technology filter (comma-separated if plain text) |
| Location name | Plain text | – | Shown under the title |
| Latitude | Number | – | Marker position — story still lists without it |
| Longitude | Number | – | Marker position |
| Short description | Plain text | – | Card and popup summary |
| Featured image | Image | – | Card thumbnail and popup header |
| At a glance | Rich text | – | Popup section |
| Their electrification journey | Rich text | – | Popup section |
| How QEA supported them | Rich text | – | Popup section |
| What they say about QEA | Rich text | – | Popup section |
| Find out more | Rich text | – | Popup section |
| Explore more | Rich text | – | Popup section |

**Type and Technology are not hard-coded.** The filter chips are built
from whatever values actually appear in the CMS. Add a fourth type —
*Schools*, say — and a *Schools* chip appears with no code change. The
`typeOrder` / `techOrder` options only fix the display order of values
already known; anything unrecognised is appended alphabetically.

### 2. The hidden Collection List

The component reads stories from a Collection List rendered into the page
and hidden with CSS. Add a Collection List to the page, bind it to Local
Stories, set **Limit** high enough to include every story, and give the
wrapper the ID `qea-stories-data` with `display: none`.

There are two ways to emit each item. **Method B is faster** and handles
rich text without fighting the Designer.

#### Method B — one Embed inside the Collection Item (recommended)

Drop a single **Embed** element inside the Collection Item and paste this,
using the purple *Add Field* button to insert each CMS field where the
`{{ }}` placeholders sit:

```html
<div class="qea-story-item"
     data-title="{{ Name }}"
     data-slug="{{ Slug }}"
     data-type="{{ Type }}"
     data-technologies="{{ Technology }}"
     data-location="{{ Location name }}"
     data-lat="{{ Latitude }}"
     data-lng="{{ Longitude }}"
     data-summary="{{ Short description }}">
  <img data-image="featured" src="{{ Featured image }}" alt="">
  <div data-field="glance">{{ At a glance }}</div>
  <div data-field="journey">{{ Their electrification journey }}</div>
  <div data-field="support">{{ How QEA supported them }}</div>
  <div data-field="quote">{{ What they say about QEA }}</div>
  <div data-field="find-out-more">{{ Find out more }}</div>
  <div data-field="explore-more">{{ Explore more }}</div>
</div>
```

#### Method A — custom attributes in the Designer

Bind each `data-*` value as a Custom Attribute on the Collection Item.
Note that **Webflow cannot bind an image or rich text field to a custom
attribute** — those must be real child elements, exactly as in Method B.
This is why the component reads short scalars from attributes and
everything else from child elements.

If Technology is a multi-reference, render it as a nested Collection List
of elements carrying `data-field="technology"`; the component reads those
instead of the comma-separated attribute.

### 3. Adding a new story later

1. Webflow → CMS → Local Stories → **New Story**.
2. Fill in at minimum: Name, Type, Latitude, Longitude, Short description.
3. Publish.

The map picks it up on the next page load. No code change, no redeploy.

A story with blank coordinates still appears in the list — it just has no
marker. Blank lat/lng is treated as *no location*, not as `0, 0`, so an
unfinished story never lands in the Atlantic off the coast of Ghana.

---

## Embedding

### Option A — iframe (simplest)

```html
<iframe src="https://rewiring-nz.github.io/qea-local-stories/embed.html"
        style="width:100%;height:760px;border:0"
        title="QEA Local Stories"
        loading="lazy"></iframe>
```

The iframe is isolated from the host page's CSS, which is the main
attraction. The catch is that the CMS data has to live inside the iframe,
so this suits a copy of the data or a separate CMS-bound page rather than
a Collection List on the parent page.

### Option B — paste into the page (recommended for Webflow)

1. Add the hidden Collection List described above.
2. Add an **Embed** element and paste the entire contents of
   `webflow-embed.html`.

Both live in the same document, so the component reads the real CMS data
directly. This is the option to use on the Local Stories page.

---

## Configuration

Pass options to `initQeaStoriesMap({...})`, or set
`window.QEA_STORIES_CONFIG` before the script runs.

| Option | Default | Notes |
|---|---|---|
| `listSelector` | `#qea-stories-data .qea-story-item` | Where the CMS items are |
| `mapSelector` | `#qea-stories-map` | Element the component renders into |
| `center` / `zoom` | `[168.6626, -45.0312]`, `9.2` | Initial view |
| `selectedZoom` | `13` | Zoom when flying to a story |
| `basemap` | `"light"` | Or `"satellite"` |
| `fitToStories` | `true` | Fit bounds to all stories on load |
| `urlParam` | `"story"` | Deep-link query parameter |
| `syncUrl` | `true` | Set `false` to leave the address bar alone |
| `cooperativeGestures` | `true` | Requires ctrl/⌘ + scroll to zoom — stops the map hijacking page scroll |
| `typeOrder` / `techOrder` | see source | Display order of known filter values |

The instance returned exposes `select(slug)`, `clearSelection()`,
`setFilter(group, value)`, `getState()` and `map`.

---

## URL state, and what to do inside an iframe

When a story is selected the component updates the address bar to
`?story=angela-in-frankton` using `history.replaceState`. `replaceState`
rather than `pushState` is deliberate: pushing would stack a history entry
per selection, so a visitor who browsed eight stories would need eight
presses of Back to leave the page.

Loading a URL that already carries `?story=` opens that story on load.

**Inside an iframe the component never touches the parent URL** — it
can't, the browser forbids it cross-origin, and attempting it would throw.
Instead it posts a message up:

```js
window.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'qea:story') return;
  var url = new URL(location.href);
  if (e.data.story) url.searchParams.set('story', e.data.story);
  else url.searchParams.delete('story');
  history.replaceState(history.state, '', url.href);
});
```

**Recommendation:** if deep links matter — and for shareable stories they
usually do — use embedding Option B. Same-origin, so URL handling just
works, with no parent-page glue. Reach for the postMessage bridge only if
an iframe is forced on you for other reasons.

In production, check `e.origin` against your own domain before acting on
the message.

---

## Architecture — how map, list, filter and popup stay in sync

The brief describes an intermittent bug where selecting a story sometimes
fails to open its popup. That class of bug comes from having *more than
one* place where "what is selected" lives. This component has exactly one.

**One state object.**

```js
var state = { type: ALL, tech: ALL, selectedId: null };
```

Nothing outside `setState()` assigns to it. Every visual surface — list
DOM, marker classes, popup, URL — is re-derived from it inside a single
`render()`. There is no code path that updates the list without also
updating the markers, because they are the same function call.

**One entry point.** Marker click, list click, keyboard activation, deep
link and the public `select()` API all funnel through `selectStory(slug)`.
There is deliberately no second path, so a new selection mechanism cannot
be added that forgets a step.

**Markers are created once and never recreated.** Filtering toggles a CSS
class and the tab index. Because no marker object is ever destroyed and
rebuilt, a stale marker reference has nothing to go stale against — the
"markers recreated after filtering" failure mode doesn't exist here.

**One popup instance, reused.** Selecting a story swaps the popup's
content and position rather than constructing a new popup per marker.
One object to keep in sync instead of N.

**Delegated event listeners.** The list is re-rendered on every filter
change, but its click handler is attached once to the `<ul>`, which is
never replaced. Re-rendering therefore cannot detach a handler or leave a
duplicate behind.

**Invalid selections are dropped in one place.** `render()` clears
`selectedId` if the current filters exclude it. So "close the popup for a
story that is no longer visible" is structural, not a rule each call site
has to remember.

**Selecting a filtered-out story widens the filter.** Rather than failing
silently, `selectStory` clears whichever filters exclude the target. A
selection is always honoured and always visible.

**Selection does not wait for the map to load.** This one is worth
dwelling on, because it was a real bug caught in testing. MapLibre only
fires `load` once its tile sources settle — so when tiles are slow or
unreachable, `load` may never arrive. An earlier version queued selections
until then, which meant a flaky connection produced a completely inert
story list. Markers, popups and camera moves all work off the map's
transform, which exists from construction, so selection now works
immediately and only the initial bounds-fit waits for `load` (with a
3-second timeout fallback so it can't hang either).

**Double-init guard.** Running the initialiser twice on the same element
returns the existing instance instead of building a second set of markers
and listeners over the same data.

---

## Accessibility

- Story cards are real `<button>` elements — keyboard focusable, with
  `aria-pressed` and `aria-current` on the selected one.
- Filter chips are buttons with `aria-pressed`, grouped in a labelled
  `role="group"`.
- Markers are buttons with `aria-label`. Filtered-out markers get
  `tabindex="-1"` and `aria-hidden`, so they leave the tab order rather
  than becoming invisible tab stops.
- The popup is `role="dialog"` with an accessible name and a labelled
  close button. `Escape` closes it.
- Keyboard-initiated selection moves focus into the popup; mouse
  selection does not steal it.
- **Selection is never signalled by colour alone.** A selected card gains
  a solid left border and bolder title; a selected marker changes size as
  well as colour. Both survive greyscale.
- The story count is announced via `role="status"` when filters change.
- `prefers-reduced-motion` is respected.

---

## Performance

- The map is initialised **once**. Filtering never re-initialises it.
- CMS data is read from the DOM once at startup — no fetch, no polling.
- Markers are created once, then shown or hidden.
- Listeners are delegated, so their count doesn't grow with stories or
  re-renders.
- Images use `loading="lazy"` and `decoding="async"`.
- The list is rebuilt into a `DocumentFragment` — one DOM insertion per
  render rather than one per card.

At dozens of stories this is comfortable. Past a few hundred markers the
right move would be a GeoJSON symbol layer with clustering instead of DOM
markers; that's a change to the marker layer only, since everything else
talks to `state` rather than to the markers.

---

## Testing

```bash
python3 -m http.server 8777    # from the repo root
npm install playwright maplibre-gl
node tests/browser-test.js
```

The suite drives a real Chromium browser. It needs MapLibre reachable —
either from the CDN, or vendored locally as `.testvendor/` (see the top of
the test file).

### Results — 49 checks, all passing

| Area | Checks |
|---|---|
| Initial render | 6 stories listed, 5 markers, coordinate-less story listed without a marker, no popup on load |
| Basic selection | first story, second story, same story twice, close, reselect after close, selected card state, URL updates |
| **Reliability** | **60 random consecutive selections** — correct popup and correct selected card every time, no reload |
| Markers | marker → correct popup, marker → correct list card, marker → URL, 20 random marker clicks, list scrolls to selection, **25 marker→marker swaps with a popup already open** |
| Filters | All→Households, Households→Businesses, Businesses→All, **30 repeated filter switches**, 18 selections after filtering, technology filter, type+technology combined, popup closes for filtered-out story |
| Deep links | `?story=` opens the right story; unknown slug degrades gracefully |
| Keyboard / a11y | Enter selects, Escape closes, cards are buttons, `aria-pressed` on cards and chips, marker labels, hidden markers leave the tab order |
| Responsive | desktop side-by-side, map 62% width, mobile stacked, mobile map height sane, no horizontal scroll, mobile selection works |
| Popup fit | every story's popup renders fully inside the map container; the bounds-fit fallback never overrides a selection |
| Robustness | re-init doesn't duplicate markers, no uncaught JS errors |

Four genuine bugs were found and fixed during testing — the first two by
the suite, the second two by looking at screenshots of the rendered
result. All four are in the exact category the brief asked to avoid:

1. **Selection gated on `map.on('load')`.** With tiles unreachable the
   event never fired and the entire list went inert. Fixed by removing the
   gate — see the architecture note above.
2. **The deep link erased itself.** The first `render()` called
   `syncUrl()`, which stripped `?story=` from the address bar *before* the
   initialiser read it, so deep links never resolved. Fixed by capturing
   the parameter before the first paint.
3. **Popups were clipped by the map.** A popup lives inside the map
   container, and sizing it as `60vh` made it nearly as tall as the map
   itself — over 400px of story content was cut off below the edge. Fixed
   by sizing the popup against the map rather than the viewport, and
   flying the camera so the marker lands with room for the popup above it
   (horizontally too, since the popup is centred on its marker).
4. **The bounds-fit fallback stole the camera.** `whenMapReady()` has a
   3-second timeout so it can't hang on unreachable tiles — but that
   timeout could fire *after* a visitor selected a story and yank the map
   back to the overview. Fixed by making `fitToVisible()` stand down
   whenever something is selected.

Bugs 3 and 4 are a reminder that a green test suite is not the same as a
correct component: both passed every behavioural assertion while being
plainly wrong on screen.

### Not yet verified

- Appearance against the real QEA design (site unreachable from the build
  environment).
- Behaviour with the real Webflow CMS output — the Collection List markup
  is modelled on the sibling `rewiring-nz/communities-map`, which uses the
  same pattern in production, but this specific collection hasn't been
  wired up yet.
- Real touch devices. Mobile layout is verified at a 390×844 viewport in
  Chromium, which is not the same as a finger on glass.

---

## Related

- [`rewiring-nz/communities-map`](https://github.com/rewiring-nz/communities-map) — the Webflow CMS reading pattern
- [`rewiring-nz/resilience-hubs-map`](https://github.com/rewiring-nz/resilience-hubs-map) — marker styling and mobile sizing groundwork
