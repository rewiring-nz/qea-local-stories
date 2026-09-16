#!/usr/bin/env bash
# Regenerates webflow-embed.html — stories.css + stories.js inlined into
# one paste-ready block for a Webflow Embed element.
#
# webflow-embed.html is a GENERATED ARTIFACT. Never hand-edit it; edit
# stories.css / stories.js and re-run this script from the repo root.
set -euo pipefail
cd "$(dirname "$0")"

OUT=webflow-embed.html

{
  cat <<'HEADER'
<!-- ==================================================================
     QEA LOCAL STORIES — paste-ready Webflow Embed
     ------------------------------------------------------------------
     GENERATED FILE — do not edit by hand.
     Regenerate with ./gen_embed.sh after changing stories.css/stories.js.

     This block contains the styles and behaviour only. The story DATA
     comes from a hidden Webflow CMS Collection List that must exist on
     the same page — see README.md, "Webflow setup".
     ================================================================== -->

<div id="qea-stories-map"></div>

<style>
HEADER
  sed 's/^/  /' stories.css
  cat <<'MID'
</style>

<script src="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js"></script>
<link href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" rel="stylesheet">
<script>
MID
  # Strip the trailing `window.initQeaStoriesMap = ...; })();` export and
  # close the IIFE around a direct call instead.
  total=$(wc -l < stories.js)
  head -n "$(( total - 3 ))" stories.js | sed 's/^/  /'
  cat <<'TAIL'

    initQeaStoriesMap({
      cooperativeGestures: true
    });
  })();
</script>
TAIL
} > "$OUT"

# Sanity checks: the export line must be gone, and the section
# boundaries must be where we expect.
if grep -q "window.initQeaStoriesMap" "$OUT"; then
  echo "ERROR: export line survived — check the head -n offset" >&2
  exit 1
fi
echo "Wrote $OUT ($(wc -l < "$OUT") lines)"
grep -n '^</style>$\|^<script>$\|^</script>$' "$OUT"
