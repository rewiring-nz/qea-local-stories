/* QEA Local Stories — embeddable map + story list.
   ---------------------------------------------------------------
   Reads stories from a hidden Webflow CMS Collection List already
   rendered into the page DOM (see README.md), then drives a MapLibre
   map and a filterable story list from ONE shared array of story
   objects.

   The single most important property of this file: the map, the list
   and the popup are all projections of the same `state`. Nothing is
   ever selected by mutating two places at once. See "THE ONE RULE"
   below before changing anything in here. */

(function () {
  "use strict";

  /* =============================================================
     MAP CONFIGURATION — kept separate from component logic so it
     can be retuned without touching any behaviour.
     Override per-embed by passing an options object to
     initQeaStoriesMap(), or globally via window.QEA_STORIES_CONFIG.
     ============================================================= */
  var DEFAULTS = {
    // Where the hidden Webflow Collection List items live.
    listSelector: "#qea-stories-data .qea-story-item",
    // The element the map is rendered into.
    mapSelector: "#qea-stories-map",
    // Queenstown Lakes.
    center: [168.6626, -45.0312],
    zoom: 9.2,
    // Zoom used when flying to a selected story.
    selectedZoom: 13,
    minZoom: 5,
    maxZoom: 17,
    // Fit to all visible stories on load / when filters change.
    fitToStories: true,
    fitPadding: 60,
    // URL query parameter used for deep links (?story=angela-in-frankton).
    urlParam: "story",
    syncUrl: true,
    // Basemap. No API key required — Esri's public raster tiles, the
    // same keyless approach used by the sibling rewiring-nz maps.
    // Swap `basemap` for "satellite" if you'd rather have imagery.
    basemap: "light",
    cooperativeGestures: true,
    // Preferred display order for filter chips. Any value found in the
    // CMS that isn't listed here is appended automatically, so the team
    // can add a new category without a code change.
    // Preferred chip order and spelling. Matches the labels the live
    // QEA Local Stories page uses; the plural forms are kept so a
    // Collection that names the option "Households" still sorts sensibly
    // instead of falling through to the alphabetical tail.
    // Supply rows directly instead of reading them from this document's
    // DOM. Used by embed.html, which receives them from the parent page.
    stories: null,
    typeOrder: ["Business", "Household", "Community", "Businesses", "Households"],
    techOrder: [
      "Solar", "Batteries", "EV", "Business", "Cooking", "Heating",
      "Hot water", "Commercial Kitchen", "Community", "Solar for Renters",
      "Electric Vehicles"
    ]
  };

  var BASEMAPS = {
    light: {
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      ],
      labels: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
      ],
      attribution: "Tiles &copy; Esri"
    },
    satellite: {
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ],
      labels: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
      ],
      attribution: "Tiles &copy; Esri"
    }
  };

  var ALL = "__all__";

  /* ============================== utils ============================== */

  function escapeHTML(str) {
    var d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }

  function slugify(str) {
    return String(str || "")
      .toLowerCase()
      .normalize("NFD")
      // Escaped rather than written literally: webflow-embed.html carries
      // no charset of its own, so anywhere it is served without one the
      // raw combining-mark bytes get decoded as Latin-1 and this becomes
      // an invalid range — which throws while the IIFE is still being
      // defined and takes the whole component down. Keep this ASCII.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // "Solar, Batteries" -> ["Solar", "Batteries"]. Also tolerates
  // semicolons and pipes, which Webflow multi-reference exports and
  // hand-typed plain-text fields both tend to produce.
  function splitList(value) {
    if (!value) return [];
    return String(value)
      .split(/[,;|]/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function isValidLatLng(lat, lng) {
    return (
      typeof lat === "number" && typeof lng === "number" &&
      !Number.isNaN(lat) && !Number.isNaN(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
      // A CMS item with the fields left blank parses to 0,0 — a point
      // in the Atlantic that is definitely not in Queenstown. Treat it
      // as "no location" rather than plotting a marker off Africa.
      !(lat === 0 && lng === 0)
    );
  }

  // A latitude outside ±90 is impossible, so a pair like
  // (167.9192, -44.6711) can only be a transposed row — Webflow's
  // Latitude and Longitude are two free number inputs and are easy to
  // fill in the wrong order. Recover the point when the swap is the
  // only reading that works, and warn so the CMS row still gets fixed
  // at source rather than silently depending on this.
  function resolveLatLng(lat, lng, label) {
    if (isValidLatLng(lat, lng)) return { lat: lat, lng: lng };
    if (isValidLatLng(lng, lat)) {
      if (window.console && window.console.warn) {
        window.console.warn(
          '[qea-stories] Latitude/Longitude look transposed for "' + label +
          '" (lat=' + lat + ", lng=" + lng + "). Plotting the swapped pair; " +
          "correct the CMS row to silence this."
        );
      }
      return { lat: lng, lng: lat };
    }
    return { lat: lat, lng: lng };
  }

  /* ========================= CMS DATA LAYER =========================
     The only place that knows what Webflow's DOM looks like. Everything
     downstream deals in plain story objects.

     Short scalar fields come from data-* custom attributes on the
     Collection Item. Rich-text and image fields cannot be bound to a
     custom attribute in Webflow, so they are real child elements
     inside the item instead, tagged with data-field="...".
     ================================================================= */

  function readRich(el, field) {
    var node = el.querySelector('[data-field="' + field + '"]');
    if (!node) return "";
    var html = node.innerHTML.trim();
    // Webflow renders an empty rich text field as an empty <div>; treat
    // that as absent so the section doesn't render as a bare heading.
    return node.textContent.trim() === "" && html.indexOf("<img") === -1 ? "" : html;
  }

  function readImage(el, field) {
    var img = el.querySelector('[data-image="' + field + '"]');
    if (!img) return "";
    // Prefer the responsive srcset Webflow emits; fall back to src.
    return img.getAttribute("src") || "";
  }

  // Both data sources — this document's CMS list, and rows posted in
  // from a parent page when the component runs in an iframe — funnel
  // through here, so there is exactly one definition of what a story is
  // and one place where slugs, coordinates and tag lists get cleaned up.
  //
  // `raw` uses the same key names either way. Rich-text values are HTML
  // strings and are injected as HTML; everything else is escaped at
  // render time. In the iframe case that means the parent page is
  // trusted, which it is — it is the same site.
  function makeStories(raws) {
    var stories = [];
    var seen = Object.create(null);

    raws.forEach(function (raw) {
      var title = String(raw.title || raw.name || "").trim();
      if (!title) return;

      var slug = String(raw.slug || "").trim() || slugify(title);
      // Duplicate slugs would make ?story= ambiguous and break the
      // byId lookup that everything else relies on. Disambiguate rather
      // than silently dropping the second story.
      if (seen[slug]) {
        var n = 2;
        while (seen[slug + "-" + n]) n++;
        slug = slug + "-" + n;
      }
      seen[slug] = true;

      var point = resolveLatLng(parseFloat(raw.lat), parseFloat(raw.lng), title);
      var lat = point.lat;
      var lng = point.lng;

      // An injected row may give technologies as a real array; a DOM row
      // gives a comma-joined string.
      var technologies = Array.isArray(raw.technologies)
        ? raw.technologies.map(function (t) { return String(t).trim(); }).filter(Boolean)
        : splitList(raw.technologies);

      stories.push({
        slug: slug,
        title: title,
        type: String(raw.type || "").trim(),
        technologies: technologies,
        location: String(raw.location || "").trim(),
        lat: lat,
        lng: lng,
        hasLocation: isValidLatLng(lat, lng),
        summary: String(raw.summary || "").trim(),
        url: String(raw.url || "").trim(),
        image: raw.image || "",
        glance: raw.glance || "",
        journey: raw.journey || "",
        support: raw.support || "",
        quote: raw.quote || "",
        findOutMore: raw.findOutMore || "",
        exploreMore: raw.exploreMore || ""
      });
    });

    return stories;
  }

  function readStories(listSelector) {
    var items = document.querySelectorAll(listSelector);

    return makeStories(Array.prototype.map.call(items, function (el) {
      var d = el.dataset;

      // Technologies can arrive either as a comma-joined attribute or,
      // for a Webflow multi-reference, as nested elements.
      var techNodes = el.querySelectorAll('[data-field="technology"]');
      var technologies = techNodes.length
        ? Array.prototype.map.call(techNodes, function (n) {
            return n.textContent.trim();
          }).filter(Boolean)
        : (d.technologies || d.technology || d.tech);

      return {
        title: d.title || d.name,
        slug: d.slug,
        type: d.type || d.category,
        technologies: technologies,
        location: d.location,
        lat: d.lat,
        lng: d.lng,
        // `blurb` is what the QEA Collection calls the short description.
        summary: d.summary || d.description || d.blurb,
        url: d.url || d.link,
        image: readImage(el, "featured"),
        glance: readRich(el, "glance"),
        journey: readRich(el, "journey"),
        support: readRich(el, "support"),
        quote: readRich(el, "quote"),
        findOutMore: readRich(el, "find-out-more"),
        exploreMore: readRich(el, "explore-more")
      };
    }));
  }

  /* ====================== DERIVED FILTER OPTIONS ======================
     Built from the data, not hardcoded, so a new category in the CMS
     shows up as a new chip with no code change. `order` just fixes the
     position of the values we already know about.
     ================================================================== */

  // Webflow lets the same tag be typed several ways across CMS rows —
  // "solar" and "Solar", "Commercial kitchen" and "Commercial Kitchen".
  // Left alone each spelling becomes its own chip, and picking one
  // hides the stories that chose the other. Fold them onto one display
  // spelling: the one from the preferred order if it matches
  // case-insensitively, otherwise the first spelling the data uses.
  //
  // This normalises how a tag is *written*, not which tags exist — a
  // category QEA invents tomorrow still appears on its own. Don't turn
  // it into a lookup of permitted values.
  function canonicaliser(values, order) {
    var canon = Object.create(null);
    function register(v) {
      var k = v.toLowerCase();
      if (!canon[k]) canon[k] = v;
    }
    order.forEach(register);
    values.forEach(register);
    return function (v) {
      return v ? (canon[v.toLowerCase()] || v) : v;
    };
  }

  // Runs once, over every story, before anything derives a chip or a
  // pill from the data — so the list, the filters and storyMatches()
  // are all comparing the same strings.
  function canonicaliseTags(stories, typeOrder, techOrder) {
    var types = [];
    var techs = [];
    stories.forEach(function (s) {
      if (s.type) types.push(s.type);
      s.technologies.forEach(function (t) { techs.push(t); });
    });

    var toType = canonicaliser(types, typeOrder);
    var toTech = canonicaliser(techs, techOrder);

    stories.forEach(function (s) {
      s.type = toType(s.type);
      var seen = Object.create(null);
      // A single row spelling one tag twice ("Solar, solar") collapses
      // to one pill rather than rendering a duplicate.
      s.technologies = s.technologies.map(toTech).filter(function (t) {
        if (seen[t]) return false;
        seen[t] = true;
        return true;
      });
    });

    return stories;
  }

  function collectValues(stories, pick, order) {
    var found = Object.create(null);
    stories.forEach(function (s) {
      [].concat(pick(s)).forEach(function (v) {
        if (v) found[v] = true;
      });
    });
    var known = order.filter(function (v) { return found[v]; });
    var extra = Object.keys(found).filter(function (v) {
      return order.indexOf(v) === -1;
    }).sort();
    return known.concat(extra);
  }

  /* ============================== VIEW =============================== */

  function storyMatches(story, state) {
    if (state.type !== ALL && story.type !== state.type) return false;
    if (state.tech !== ALL && story.technologies.indexOf(state.tech) === -1) {
      return false;
    }
    return true;
  }

  function pillsHTML(story) {
    var out = "";
    if (story.type) {
      out += '<span class="qea-pill qea-pill--type">' + escapeHTML(story.type) + "</span>";
    }
    story.technologies.forEach(function (t) {
      out += '<span class="qea-pill qea-pill--tech">' + escapeHTML(t) + "</span>";
    });
    return out;
  }

  function cardHTML(story) {
    var img = story.image
      ? '<img class="qea-card__img" src="' + escapeHTML(story.image) +
        '" alt="" loading="lazy" decoding="async">'
      : "";
    var loc = story.location
      ? '<p class="qea-card__loc">' + escapeHTML(story.location) + "</p>"
      : "";
    var sum = story.summary
      ? '<p class="qea-card__summary">' + escapeHTML(story.summary) + "</p>"
      : "";
    return (
      img +
      '<div class="qea-card__body">' +
        '<h3 class="qea-card__title">' + escapeHTML(story.title) + "</h3>" +
        loc +
        '<div class="qea-card__pills">' + pillsHTML(story) + "</div>" +
        sum +
      "</div>"
    );
  }

  function section(label, html) {
    if (!html) return "";
    return (
      '<section class="qea-detail__section">' +
        '<h4 class="qea-detail__heading">' + escapeHTML(label) + "</h4>" +
        '<div class="qea-detail__rich">' + html + "</div>" +
      "</section>"
    );
  }

  // Rich-text HTML here comes from the site's own Webflow CMS — the same
  // trust boundary as the rest of the page — so it is injected as-is.
  // Everything sourced from a data-* attribute is escaped.
  function popupHTML(story) {
    var img = story.image
      ? '<img class="qea-popup__img" src="' + escapeHTML(story.image) +
        '" alt="" loading="lazy" decoding="async">'
      : "";
    var loc = story.location
      ? '<p class="qea-popup__loc">' + escapeHTML(story.location) + "</p>"
      : "";
    var sum = story.summary
      ? '<p class="qea-popup__summary">' + escapeHTML(story.summary) + "</p>"
      : "";
    return (
      '<button type="button" class="qea-popup__close" aria-label="Close story">&times;</button>' +
      '<div class="qea-popup__scroll">' +
        img +
        '<div class="qea-popup__body">' +
          '<h3 class="qea-popup__title">' + escapeHTML(story.title) + "</h3>" +
          loc +
          '<div class="qea-card__pills">' + pillsHTML(story) + "</div>" +
          sum +
          section("At a glance", story.glance) +
          section("Their electrification journey", story.journey) +
          section("How QEA supported them", story.support) +
          section("What they say about QEA", story.quote) +
          section("Find out more", story.findOutMore) +
          section("Explore more", story.exploreMore) +
        "</div>" +
      "</div>"
    );
  }

  /* ============================ COMPONENT ============================ */

  function initQeaStoriesMap(userOpts) {
    var opts = {};
    var globalCfg = window.QEA_STORIES_CONFIG || {};
    Object.keys(DEFAULTS).forEach(function (k) { opts[k] = DEFAULTS[k]; });
    Object.keys(globalCfg).forEach(function (k) { opts[k] = globalCfg[k]; });
    Object.keys(userOpts || {}).forEach(function (k) { opts[k] = userOpts[k]; });

    var root = document.querySelector(opts.mapSelector);
    if (!root) return null;
    // Guard against a double init (e.g. the script pasted into two
    // Webflow Embeds, or a re-run after a Webflow page transition).
    // Without this you'd get two sets of markers and two sets of
    // listeners on the same data — a classic source of the exact
    // "sometimes the popup doesn't open" bug this component avoids.
    if (root.__qeaStoriesInstance) return root.__qeaStoriesInstance;

    // In an iframe there is no CMS list in this document — the parent
    // reads its own Collection and posts the rows in as opts.stories.
    var stories = canonicaliseTags(
      opts.stories ? makeStories(opts.stories) : readStories(opts.listSelector),
      opts.typeOrder, opts.techOrder
    );
    var byId = Object.create(null);
    stories.forEach(function (s) { byId[s.slug] = s; });

    /* ---- THE ONE RULE -------------------------------------------
       `state` is the single source of truth. Nothing outside
       setState() may assign to it, and every visual surface (list,
       markers, popup, URL) is re-derived from it in render(). If you
       add a feature, add it to render() — never reach into the DOM to
       "also" update something, or the surfaces can drift apart.
       ------------------------------------------------------------- */
    var state = { type: ALL, tech: ALL, selectedId: null };

    // Guards the popup 'close' listener while WE are the ones swapping
    // the popup's content — MapLibre removes a popup internally when it
    // is re-added, and without this flag that internal close would
    // immediately clear the selection we are in the middle of setting.
    var applyingPopup = false;
    var markers = Object.create(null);   // slug -> maplibregl.Marker
    var markerEls = Object.create(null); // slug -> HTMLElement
    var cardEls = Object.create(null);   // slug -> HTMLElement (current render)

    /* -------------------------- layout -------------------------- */
    root.classList.add("qea-root");
    root.innerHTML =
      '<div class="qea-layout">' +
        '<div class="qea-mapcol"><div class="qea-map"></div></div>' +
        '<aside class="qea-listcol" aria-label="Local stories">' +
          '<div class="qea-filters">' +
            '<div class="qea-filters__row">' +
              '<span class="qea-filters__label" aria-hidden="true">Type</span>' +
              '<div class="qea-filters__group" data-group="type" role="group" aria-label="Filter by type"></div>' +
            "</div>" +
            '<div class="qea-filters__row">' +
              '<span class="qea-filters__label" aria-hidden="true">Technology</span>' +
              '<div class="qea-filters__group" data-group="tech" role="group" aria-label="Filter by technology"></div>' +
            "</div>" +
          "</div>" +
          '<p class="qea-count" role="status" aria-live="polite"></p>' +
          '<ul class="qea-list"></ul>' +
          '<p class="qea-empty" hidden>No stories match these filters.</p>' +
        "</aside>" +
      "</div>";

    var mapEl = root.querySelector(".qea-map");
    var listEl = root.querySelector(".qea-list");
    var emptyEl = root.querySelector(".qea-empty");
    var countEl = root.querySelector(".qea-count");
    var typeGroup = root.querySelector('[data-group="type"]');
    var techGroup = root.querySelector('[data-group="tech"]');

    /* -------------------------- filters -------------------------- */
    function renderFilterGroup(group, values, current, allLabel) {
      var html = '<button type="button" class="qea-chip" data-value="' + ALL +
        '" aria-pressed="' + (current === ALL) + '">' + escapeHTML(allLabel) + "</button>";
      values.forEach(function (v) {
        html += '<button type="button" class="qea-chip" data-value="' + escapeHTML(v) +
          '" aria-pressed="' + (current === v) + '">' + escapeHTML(v) + "</button>";
      });
      group.innerHTML = html;
    }

    var typeValues = collectValues(stories, function (s) { return s.type; }, opts.typeOrder);
    var techValues = collectValues(stories, function (s) { return s.technologies; }, opts.techOrder);

    /* ---------------------------- map ---------------------------- */
    var basemap = BASEMAPS[opts.basemap] || BASEMAPS.light;
    var map = new maplibregl.Map({
      container: mapEl,
      cooperativeGestures: opts.cooperativeGestures,
      minZoom: opts.minZoom,
      maxZoom: opts.maxZoom,
      center: opts.center,
      zoom: opts.zoom,
      style: {
        version: 8,
        sources: {
          base: {
            type: "raster", tileSize: 256, maxzoom: 17,
            tiles: basemap.tiles, attribution: basemap.attribution
          },
          labels: {
            type: "raster", tileSize: 256, maxzoom: 17, tiles: basemap.labels
          }
        },
        layers: [
          { id: "base", type: "raster", source: "base" },
          { id: "labels", type: "raster", source: "labels" }
        ]
      }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // ONE popup instance for the whole component, reused for every
    // story. Per-marker popups are how stale references creep in; with
    // a single instance there is exactly one thing to keep in sync.
    // focusAfterOpen:false avoids MapLibre auto-focusing the first link
    // inside the popup, which can scroll the host page mid-flyTo.
    var popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      focusAfterOpen: false,
      maxWidth: "340px",
      className: "qea-popup",
      // Fixed anchor rather than MapLibre's automatic choice: the camera
      // is positioned below to guarantee clearance, which only works if
      // we know which way the popup opens.
      anchor: "bottom",
      offset: 34
    });
    popup.on("close", function () {
      if (applyingPopup) return; // our own content swap, not a real close
      if (state.selectedId) setState({ selectedId: null });
    });

    /* -------------------------- markers --------------------------
       Created exactly ONCE, here, and never recreated. Filtering only
       toggles a class. This is what makes "markers being recreated
       after filtering" structurally impossible.
       ------------------------------------------------------------- */
    stories.forEach(function (story) {
      if (!story.hasLocation) return;
      var el = document.createElement("button");
      el.type = "button";
      el.className = "qea-marker";
      el.setAttribute("aria-label", story.title);
      el.dataset.slug = story.slug;
      el.innerHTML = '<span class="qea-marker__pin" aria-hidden="true"></span>';
      // NOTE: never give .qea-marker its own `position` in CSS —
      // MapLibre sets an inline transform on this element and its own
      // positioning must win.
      el.addEventListener("click", function (ev) {
        ev.stopPropagation();
        selectStory(story.slug, { source: "marker", keyboard: ev.detail === 0 });
      });
      markerEls[story.slug] = el;
      markers[story.slug] = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([story.lng, story.lat])
        .addTo(map);
    });

    /* ----------------- keeping the popup inside the map -------------
       A popup sits inside the map container and is clipped by it, so its
       height has to be measured against the MAP rather than the viewport
       — 60vh of a tall page is easily taller than a 560px map, which
       clips most of the story out of sight. This caps it to the map's own
       height and leaves room for the pin and the tip.
       --------------------------------------------------------------- */
    function popupMaxHeight() {
      var h = mapEl.getBoundingClientRect().height || 560;
      return Math.max(160, Math.round(h - 160));
    }

    function syncPopupMax() {
      root.style.setProperty("--qea-popup-max", popupMaxHeight() + "px");
    }

    syncPopupMax();
    window.addEventListener("resize", syncPopupMax);

    // The component is sized by its container, not by the window, so the
    // box can change without a window resize ever firing — a Webflow
    // breakpoint, a parent that grows, or someone editing the Embed's
    // height in the Designer. Watch the element itself and tell MapLibre
    // to re-measure, otherwise the canvas keeps its old dimensions and
    // the map renders letterboxed inside its own container.
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        map.resize();
        syncPopupMax();
      });
      ro.observe(root);
    }

    /* ------------------------ state & render ---------------------- */
    function setState(patch) {
      var next = false;
      Object.keys(patch).forEach(function (k) {
        if (state[k] !== patch[k]) { state[k] = patch[k]; next = true; }
      });
      if (next) render();
    }

    function visibleStories() {
      return stories.filter(function (s) { return storyMatches(s, state); });
    }

    function render() {
      var visible = visibleStories();
      var visibleIds = Object.create(null);
      visible.forEach(function (s) { visibleIds[s.slug] = true; });

      // A selection that the current filters exclude is dropped here,
      // in one place — so "close any popup belonging to a story that is
      // no longer visible" can't be forgotten at any call site.
      if (state.selectedId && !visibleIds[state.selectedId]) {
        state.selectedId = null;
      }

      renderFilterGroup(typeGroup, typeValues, state.type, "All");
      renderFilterGroup(techGroup, techValues, state.tech, "All technologies");

      // --- list ---
      cardEls = Object.create(null);
      var frag = document.createDocumentFragment();
      visible.forEach(function (s) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "qea-card";
        btn.dataset.slug = s.slug;
        btn.innerHTML = cardHTML(s);
        var selected = s.slug === state.selectedId;
        btn.setAttribute("aria-pressed", String(selected));
        if (selected) {
          btn.classList.add("is-selected");
          btn.setAttribute("aria-current", "true");
        }
        li.appendChild(btn);
        frag.appendChild(li);
        cardEls[s.slug] = btn;
      });
      listEl.innerHTML = "";
      listEl.appendChild(frag);

      emptyEl.hidden = visible.length !== 0;
      countEl.textContent =
        visible.length + (visible.length === 1 ? " story" : " stories");

      // --- markers ---
      stories.forEach(function (s) {
        var el = markerEls[s.slug];
        if (!el) return;
        var show = !!visibleIds[s.slug];
        el.classList.toggle("is-hidden", !show);
        el.classList.toggle("is-selected", show && s.slug === state.selectedId);
        // Keep hidden markers out of the tab order as well as out of sight.
        el.tabIndex = show ? 0 : -1;
        el.setAttribute("aria-hidden", show ? "false" : "true");
      });

      // --- popup ---
      var sel = state.selectedId ? byId[state.selectedId] : null;
      if (sel && sel.hasLocation) {
        var node = document.createElement("div");
        node.className = "qea-popup__inner";
        node.setAttribute("role", "dialog");
        node.setAttribute("aria-label", sel.title);
        node.tabIndex = -1;
        node.innerHTML = popupHTML(sel);
        node.querySelector(".qea-popup__close").addEventListener("click", function () {
          setState({ selectedId: null });
        });
        applyingPopup = true;
        popup.setLngLat([sel.lng, sel.lat]).setDOMContent(node).addTo(map);
        applyingPopup = false;
      } else if (popup.isOpen()) {
        applyingPopup = true;
        popup.remove();
        applyingPopup = false;
      }

      syncUrl();
    }

    /* --------------------------- the URL --------------------------
       Only ever touched with replaceState on the component's OWN
       document, and only when we're the top-level page. Inside an
       iframe the parent's URL is off-limits (cross-origin), so we post
       a message up instead and let the host page decide. See README.
       -------------------------------------------------------------- */
    var inIframe = (function () {
      try { return window.self !== window.top; } catch (e) { return true; }
    })();

    function syncUrl() {
      if (!opts.syncUrl) return;
      if (inIframe) {
        try {
          window.parent.postMessage({
            type: "qea:story",
            story: state.selectedId || null
          }, "*");
        } catch (e) { /* parent unreachable — not fatal */ }
        return;
      }
      try {
        var url = new URL(window.location.href);
        if (state.selectedId) url.searchParams.set(opts.urlParam, state.selectedId);
        else url.searchParams.delete(opts.urlParam);
        if (url.href !== window.location.href) {
          window.history.replaceState(window.history.state, "", url.href);
        }
      } catch (e) { /* older browser — deep links simply won't update */ }
    }

    /* ------------------------ THE ENTRY POINT ----------------------
       Every way of choosing a story — list click, marker click, deep
       link, programmatic API — goes through here. There is deliberately
       no second path.
       --------------------------------------------------------------- */
    function selectStory(slug, o) {
      o = o || {};
      var story = byId[slug];
      if (!story) return false;

      // Selecting a story hidden by the current filters would leave the
      // list and map disagreeing. Clear the filters that exclude it so
      // the selection is always honoured and always visible.
      var patch = { selectedId: slug };
      if (state.type !== ALL && story.type !== state.type) patch.type = ALL;
      if (state.tech !== ALL && story.technologies.indexOf(state.tech) === -1) {
        patch.tech = ALL;
      }

      // Re-render even when the same story is clicked twice, so a
      // popup the user closed manually comes back.
      if (state.selectedId === slug) render();
      setState(patch);

      if (story.hasLocation) {
        // Place the marker low enough in the frame that the popup, which
        // opens upward, fits entirely inside the map. `offset` shifts
        // where the target coordinate lands relative to the container
        // centre, so this is one animation rather than a fly-then-pan.
        var mapH = mapEl.getBoundingClientRect().height || 560;
        var popEl = popup.getElement();
        var popH = popEl ? popEl.offsetHeight : 0;
        // popH is the content box; the rendered popup is taller once the
        // tip and shadow are included, so budget ~86px of clearance
        // rather than trusting offsetHeight alone.
        var wantY = Math.min(mapH - 24, Math.max(mapH / 2, popH + 86));

        // The popup is centred horizontally on the marker, so the marker
        // needs at least half a popup-width of clearance from each edge.
        var mapW = mapEl.getBoundingClientRect().width || 600;
        var popW = popEl ? popEl.offsetWidth : 340;
        var halfW = popW / 2 + 12;
        var wantX = mapW / 2;
        if (halfW * 2 < mapW) {
          wantX = Math.min(mapW - halfW, Math.max(halfW, mapW / 2));
        }

        map.flyTo({
          center: [story.lng, story.lat],
          zoom: Math.max(map.getZoom(), opts.selectedZoom),
          offset: [Math.round(wantX - mapW / 2), Math.round(wantY - mapH / 2)],
          speed: 1.2,
          essential: true
        });
      }

      if (o.source === "marker") scrollListTo(slug);
      if (o.keyboard) focusPopup();
      return true;
    }

    function scrollListTo(slug) {
      var card = cardEls[slug];
      if (!card) return;
      if (card.scrollIntoView) {
        card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }

    function focusPopup() {
      var inner = popup.getElement && popup.getElement();
      var dialog = inner && inner.querySelector(".qea-popup__inner");
      if (dialog) dialog.focus();
    }

    /* ------------------------- event wiring ------------------------
       Delegated listeners, attached once to containers that are never
       replaced. Re-rendering the list therefore cannot detach a handler
       or leave a duplicate behind.
       --------------------------------------------------------------- */
    listEl.addEventListener("click", function (ev) {
      var card = ev.target.closest(".qea-card");
      if (!card || !listEl.contains(card)) return;
      selectStory(card.dataset.slug, {
        source: "list",
        keyboard: ev.detail === 0
      });
    });

    root.querySelector(".qea-filters").addEventListener("click", function (ev) {
      var chip = ev.target.closest(".qea-chip");
      if (!chip) return;
      var group = chip.closest(".qea-filters__group").dataset.group;
      var patch = {};
      patch[group] = chip.dataset.value;
      setState(patch);
    });

    map.on("click", function () { setState({ selectedId: null }); });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && state.selectedId) setState({ selectedId: null });
    });

    /* --------------------- async init, done safely -----------------
       Selecting a story deliberately does NOT wait for the map's 'load'
       event. MapLibre only fires 'load' once its sources settle, so a
       slow or unreachable tile server can delay it indefinitely — and
       gating selection on it would leave the whole list inert exactly
       when the network is worst. Markers, popups and camera moves all
       work off the map's transform, which exists from construction, so
       selection is safe immediately.

       Only the initial bounds fit genuinely wants a settled map, and
       even that gets a timeout fallback so it cannot hang forever.
       --------------------------------------------------------------- */
    function whenMapReady(fn) {
      var done = false;
      function run() { if (done) return; done = true; fn(); }
      if (map.loaded()) { run(); return; }
      map.once("load", run);
      setTimeout(run, 3000);
    }

    function fitToVisible() {
      if (!opts.fitToStories) return;
      // Never yank the camera away from a story the visitor has already
      // chosen. whenMapReady() carries a timeout fallback, so this can
      // otherwise fire seconds after a selection and undo its flyTo.
      if (state.selectedId) return;
      var pts = visibleStories().filter(function (s) { return s.hasLocation; });
      if (pts.length < 2) return;
      var b = new maplibregl.LngLatBounds();
      pts.forEach(function (s) { b.extend([s.lng, s.lat]); });
      map.fitBounds(b, { padding: opts.fitPadding, duration: 0, maxZoom: 13 });
    }

    // Read the deep link BEFORE the first paint. render() calls
    // syncUrl(), and with nothing selected yet that strips ?story= from
    // the address bar — so reading it afterwards would always come back
    // empty. Capture first, render second.
    var initialSlug = null;
    if (opts.syncUrl) {
      try {
        initialSlug = new URL(window.location.href).searchParams.get(opts.urlParam);
      } catch (e) { /* ignore */ }
    }

    // First paint — the list is interactive from this moment on,
    // whether or not a single map tile ever arrives.
    render();
    if (initialSlug && byId[initialSlug]) {
      selectStory(initialSlug, { source: "url" });
    } else {
      whenMapReady(fitToVisible);
    }

    var instance = {
      map: map,
      stories: stories,
      select: function (slug) { return selectStory(slug, { source: "api" }); },
      clearSelection: function () { setState({ selectedId: null }); },
      setFilter: function (group, value) {
        var p = {}; p[group] = value || ALL; setState(p);
      },
      getState: function () {
        return { type: state.type, tech: state.tech, selectedId: state.selectedId };
      }
    };
    root.__qeaStoriesInstance = instance;
    return instance;
  }

  window.initQeaStoriesMap = initQeaStoriesMap;
})();
