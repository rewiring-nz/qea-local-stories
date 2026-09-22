const { chromium } = require('playwright');

// Point BASE at a page that loads stories.js/stories.css plus a stand-in
// CMS list. `test-harness.html` is index.html with the CDN URLs rewritten
// to a local .testvendor/ copy of MapLibre, for environments where the CDN
// is unreachable; against a live CDN you can use index.html directly.
const BASE = process.env.QEA_TEST_URL || 'http://127.0.0.1:8777/test-harness.html';
// Leave CHROME_PATH unset to use Playwright's own resolution.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

let pass = 0, fail = 0; const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const popupTitle = p => p.evaluate(() => {
  const el = document.querySelector('.qea-popup__title');
  return el && el.offsetParent !== null ? el.textContent.trim() : null;
});
const selectedCard = p => p.evaluate(() => {
  const el = document.querySelector('.qea-card.is-selected');
  return el ? el.dataset.slug : null;
});
const visibleCards = p => p.$$eval('.qea-card', els => els.map(e => e.dataset.slug));
const visibleMarkers = p => p.$$eval('.qea-marker', els =>
  els.filter(e => !e.classList.contains('is-hidden')).map(e => e.dataset.slug));
const storyParam = p => p.evaluate(() => new URL(location.href).searchParams.get('story'));

async function newPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load|net::|tile/i.test(m.text())) errors.push(m.text()); });
  await page.goto(url || BASE, { waitUntil: 'load' });
  await page.waitForSelector('.qea-card', { timeout: 15000 });
  await page.waitForTimeout(1200); // let map 'load' fire
  page._errors = errors;
  return page;
}

(async () => {
  const browser = await chromium.launch(LAUNCH);

  // ---------------------------------------------------------------
  console.log('\n[1] Initial render');
  let page = await newPage(browser);
  const cards = await visibleCards(page);
  check('6 stories render in the list', cards.length === 6, `got ${cards.length}`);
  const mk = await visibleMarkers(page);
  check('5 markers (story without coords has none)', mk.length === 5, `got ${mk.length}`);
  check('no marker plotted for coordinate-less story', !mk.includes('wakatipu-high-school'));
  check('no popup open initially', (await popupTitle(page)) === null);

  // ---------------------------------------------------------------
  console.log('\n[2] Basic selection');
  await page.click('.qea-card[data-slug="angela-in-frankton"]');
  await page.waitForTimeout(400);
  check('first story opens correct popup', (await popupTitle(page)) === 'Angela in Frankton', await popupTitle(page));
  check('first story marked selected in list', (await selectedCard(page)) === 'angela-in-frankton');
  check('URL updates to slug', (await storyParam(page)) === 'angela-in-frankton');

  await page.click('.qea-card[data-slug="ziptrek"]');
  await page.waitForTimeout(400);
  check('second story opens correct popup', (await popupTitle(page)) === 'Ziptrek Ecotours', await popupTitle(page));
  check('URL follows second story', (await storyParam(page)) === 'ziptrek');

  // same story twice
  await page.click('.qea-card[data-slug="ziptrek"]');
  await page.waitForTimeout(300);
  check('clicking same story twice keeps popup open', (await popupTitle(page)) === 'Ziptrek Ecotours');

  // close then reselect the same one
  await page.click('.qea-popup__close');
  await page.waitForTimeout(300);
  check('close button dismisses popup', (await popupTitle(page)) === null);
  check('closing clears selected card', (await selectedCard(page)) === null);
  await page.click('.qea-card[data-slug="ziptrek"]');
  await page.waitForTimeout(400);
  check('reselecting after close reopens popup', (await popupTitle(page)) === 'Ziptrek Ecotours');

  // ---------------------------------------------------------------
  console.log('\n[3] Reliability — 60 consecutive selections, no reload');
  const EXPECT = {
    'angela-in-frankton': 'Angela in Frankton',
    'ziptrek': 'Ziptrek Ecotours',
    'headwaters-eco-lodge': 'Headwaters Eco Lodge',
    'queenstown-golf-club': 'Queenstown Golf Club',
    'milford-infrastructure': 'Milford Infrastructure',
  };
  const slugs = Object.keys(EXPECT);
  let mismatches = 0, firstBad = null;
  for (let i = 0; i < 60; i++) {
    const slug = slugs[Math.floor(Math.random() * slugs.length)];
    await page.click(`.qea-card[data-slug="${slug}"]`);
    await page.waitForTimeout(140);
    const t = await popupTitle(page);
    const s = await selectedCard(page);
    if (t !== EXPECT[slug] || s !== slug) {
      mismatches++;
      if (!firstBad) firstBad = `iteration ${i}: wanted ${EXPECT[slug]}, popup=${t}, card=${s}`;
    }
  }
  check('60 random consecutive selections all correct', mismatches === 0, firstBad || `${mismatches} mismatches`);

  // ---------------------------------------------------------------
  console.log('\n[4] Markers');
  // Centre the map on a story before clicking its marker: the markers are
  // spread across Queenstown Lakes and Fiordland, so after a fly-to some sit
  // outside the viewport. Moving the camera first also exercises "select a
  // story after manually moving the map".
  const coords = await page.evaluate(() =>
    Object.fromEntries(document.querySelector('#qea-stories-map').__qeaStoriesInstance
      .stories.filter(s => s.hasLocation).map(s => [s.slug, [s.lng, s.lat]])));

  async function clickMarker(slug) {
    // Dismiss any open popup first. A popup sits above the map and will
    // cover nearby markers — you genuinely cannot click through one, which
    // is standard map behaviour rather than a defect.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    await page.evaluate(([c]) => {
      const inst = document.querySelector('#qea-stories-map').__qeaStoriesInstance;
      inst.map.jumpTo({ center: c, zoom: 12 });
    }, [coords[slug]]);
    await page.waitForTimeout(120);
    await page.click(`.qea-marker[data-slug="${slug}"]`, { timeout: 5000 });
    await page.waitForTimeout(160);
  }

  await clickMarker('milford-infrastructure');
  check('marker click opens correct popup', (await popupTitle(page)) === 'Milford Infrastructure', await popupTitle(page));
  check('marker click selects matching list card', (await selectedCard(page)) === 'milford-infrastructure');
  check('marker click updates URL', (await storyParam(page)) === 'milford-infrastructure');

  let markerMismatch = 0, firstMarkerBad = null;
  for (let i = 0; i < 20; i++) {
    const slug = slugs[Math.floor(Math.random() * slugs.length)];
    await clickMarker(slug);
    const t = await popupTitle(page), sc = await selectedCard(page);
    if (t !== EXPECT[slug] || sc !== slug) {
      markerMismatch++;
      if (!firstMarkerBad) firstMarkerBad = `wanted ${EXPECT[slug]}, popup=${t}, card=${sc}`;
    }
  }
  check('20 random marker clicks all correct', markerMismatch === 0, firstMarkerBad || `${markerMismatch} mismatches`);

  // marker -> list scroll sync
  await clickMarker('milford-infrastructure');
  await page.waitForTimeout(700); // smooth scrollIntoView needs to settle
  const inView = await page.evaluate(() => {
    const card = document.querySelector('.qea-card.is-selected');
    const list = document.querySelector('.qea-list');
    if (!card) return false;
    const c = card.getBoundingClientRect(), l = list.getBoundingClientRect();
    return c.bottom > l.top - 1 && c.top < l.bottom + 1;
  });
  check('marker click scrolls its card into view', inView);

  // Marker -> marker transitions with a popup already open. Dispatched
  // directly so the test measures the state machine, not popup geometry.
  let swapBad = 0, firstSwapBad = null;
  for (let i = 0; i < 25; i++) {
    const slug = slugs[Math.floor(Math.random() * slugs.length)];
    await page.evaluate((s) => {
      document.querySelector(`.qea-marker[data-slug="${s}"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    }, slug);
    await page.waitForTimeout(110);
    const t = await popupTitle(page), sc = await selectedCard(page);
    if (t !== EXPECT[slug] || sc !== slug) {
      swapBad++;
      if (!firstSwapBad) firstSwapBad = `wanted ${EXPECT[slug]}, popup=${t}, card=${sc}`;
    }
  }
  check('25 marker->marker swaps with popup already open', swapBad === 0, firstSwapBad || `${swapBad} mismatches`);

  // ---------------------------------------------------------------
  console.log('\n[4b] Popup stays inside the map');
  // A popup is clipped by the map container, so a tall story must not
  // overflow it — otherwise most of the content is simply invisible.
  let clipped = [], clipDetail = null;
  for (const slug of slugs) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    await page.click(`.qea-card[data-slug="${slug}"]`);
    await page.waitForTimeout(2600); // flyTo must fully settle
    const g = await page.evaluate(() => {
      const pop = document.querySelector('.maplibregl-popup');
      const map = document.querySelector('.qea-mapcol');
      if (!pop || !map) return null;
      const p = pop.getBoundingClientRect(), m = map.getBoundingClientRect();
      return { over: p.top < m.top - 1 || p.bottom > m.bottom + 1,
               top: Math.round(p.top - m.top), bottom: Math.round(m.bottom - p.bottom) };
    });
    if (!g || g.over) { clipped.push(slug); if (!clipDetail) clipDetail = `${slug}: ${JSON.stringify(g)}`; }
  }
  check('every story popup fits inside the map', clipped.length === 0, clipDetail);

  // The bounds-fit has a timeout fallback for unreachable tiles; it must
  // never fire after a selection and drag the camera off the chosen story.
  await page.close();
  page = await newPage(browser);
  await page.click('.qea-card[data-slug="milford-infrastructure"]');
  await page.waitForTimeout(4500); // outlive the 3s fitToVisible fallback
  const held = await page.evaluate(() => {
    const i = document.querySelector('#qea-stories-map').__qeaStoriesInstance;
    const s = i.stories.find(x => x.slug === 'milford-infrastructure');
    const c = i.map.getCenter();
    return { dLng: Math.abs(c.lng - s.lng), dLat: Math.abs(c.lat - s.lat), zoom: i.map.getZoom() };
  });
  check('bounds-fit fallback does not override a selection',
    held.zoom >= 12.5 && held.dLng < 0.3 && held.dLat < 0.3, JSON.stringify(held));

  // ---------------------------------------------------------------
  console.log('\n[5] Filters');
  const chip = (group, value) => `.qea-filters__group[data-group="${group}"] .qea-chip[data-value="${value}"]`;

  // Select a Business story first, so the Households filter is guaranteed
  // to exclude the current selection. Without this the preceding random
  // loop might have left a Household selected, in which case the popup
  // correctly stays open and the assertion below would be wrong.
  await page.click('.qea-card[data-slug="ziptrek"]');
  await page.waitForTimeout(250);

  await page.click(chip('type', 'Households'));
  await page.waitForTimeout(300);
  let c = await visibleCards(page);
  check('All -> Households filters list', c.length === 1 && c[0] === 'angela-in-frankton', c.join(','));
  check('Households hides other markers', (await visibleMarkers(page)).length === 1);
  check('popup for now-hidden story closed', (await popupTitle(page)) === null);

  await page.click(chip('type', 'Businesses'));
  await page.waitForTimeout(300);
  c = await visibleCards(page);
  check('Households -> Businesses shows 3', c.length === 3, c.join(','));

  await page.click(chip('type', '__all__'));
  await page.waitForTimeout(300);
  check('Businesses -> All restores 6', (await visibleCards(page)).length === 6);

  // repeated switching
  let filterBad = 0;
  const cycle = ['Households', 'Businesses', '__all__', 'Community', 'Households', '__all__'];
  const expectCount = { 'Households': 1, 'Businesses': 3, 'Community': 2, '__all__': 6 };
  for (let r = 0; r < 5; r++) {
    for (const v of cycle) {
      await page.click(chip('type', v));
      await page.waitForTimeout(90);
      const n = (await visibleCards(page)).length;
      if (n !== expectCount[v]) filterBad++;
    }
  }
  check('30 repeated filter switches all correct', filterBad === 0, `${filterBad} wrong counts`);

  // selecting after filter changes
  await page.click(chip('type', 'Businesses'));
  await page.waitForTimeout(250);
  let afterFilterBad = 0;
  const bizSlugs = ['ziptrek', 'headwaters-eco-lodge', 'queenstown-golf-club'];
  for (let i = 0; i < 18; i++) {
    const slug = bizSlugs[i % bizSlugs.length];
    await page.click(`.qea-card[data-slug="${slug}"]`);
    await page.waitForTimeout(140);
    if ((await popupTitle(page)) !== EXPECT[slug]) afterFilterBad++;
  }
  check('18 selections after filtering all correct', afterFilterBad === 0, `${afterFilterBad} failures`);

  // technology filter
  await page.click(chip('type', '__all__'));
  await page.waitForTimeout(200);
  await page.click(chip('tech', 'Batteries'));
  await page.waitForTimeout(250);
  c = await visibleCards(page);
  check('technology filter works independently', c.length === 3, c.join(','));

  // combined filters
  await page.click(chip('type', 'Community'));
  await page.waitForTimeout(250);
  c = await visibleCards(page);
  check('type + technology combine', c.length === 1 && c[0] === 'milford-infrastructure', c.join(','));

  // selecting an excluded story clears the filters that exclude it
  await page.click(chip('type', '__all__'));
  await page.click(chip('tech', '__all__'));
  await page.waitForTimeout(250);

  // ---------------------------------------------------------------
  console.log('\n[6] Deep links');
  await page.close();
  page = await newPage(browser, BASE + '?story=queenstown-golf-club');
  check('deep link opens correct popup', (await popupTitle(page)) === 'Queenstown Golf Club', await popupTitle(page));
  check('deep link selects correct card', (await selectedCard(page)) === 'queenstown-golf-club');

  page.on('pageerror', e => page._errors.push(e.message));
  await page.close();
  page = await newPage(browser, BASE + '?story=does-not-exist');
  check('unknown slug degrades gracefully', (await popupTitle(page)) === null && (await visibleCards(page)).length === 6);

  // ---------------------------------------------------------------
  console.log('\n[7] Keyboard & accessibility');
  await page.close();
  page = await newPage(browser);
  await page.focus('.qea-card[data-slug="ziptrek"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('keyboard Enter selects story', (await popupTitle(page)) === 'Ziptrek Ecotours');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape closes popup', (await popupTitle(page)) === null);

  const aria = await page.evaluate(() => {
    const c = document.querySelector('.qea-card');
    const chip = document.querySelector('.qea-chip');
    return {
      cardIsButton: c.tagName === 'BUTTON',
      cardPressed: c.hasAttribute('aria-pressed'),
      chipPressed: chip.hasAttribute('aria-pressed'),
      markerLabel: !!document.querySelector('.qea-marker').getAttribute('aria-label'),
    };
  });
  check('cards are real buttons', aria.cardIsButton);
  check('cards expose aria-pressed', aria.cardPressed);
  check('filter chips expose aria-pressed', aria.chipPressed);
  check('markers have accessible labels', aria.markerLabel);

  const hiddenTabbable = await page.evaluate(() => {
    document.querySelector('.qea-filters__group[data-group="type"] .qea-chip[data-value="Households"]').click();
    return new Promise(r => setTimeout(() => {
      r(Array.from(document.querySelectorAll('.qea-marker.is-hidden')).filter(e => e.tabIndex !== -1).length);
    }, 250));
  });
  check('filtered-out markers leave the tab order', hiddenTabbable === 0, `${hiddenTabbable} still tabbable`);

  // ---------------------------------------------------------------
  console.log('\n[8] Responsive');
  await page.close();
  page = await newPage(browser);
  const desktop = await page.evaluate(() => {
    const m = document.querySelector('.qea-mapcol').getBoundingClientRect();
    const l = document.querySelector('.qea-listcol').getBoundingClientRect();
    return { sideBySide: Math.abs(m.top - l.top) < 5 && l.left > m.left, mapRatio: m.width / (m.width + l.width) };
  });
  check('desktop: map and list side by side', desktop.sideBySide);
  check('desktop: map ~60-65% width', desktop.mapRatio > 0.55 && desktop.mapRatio < 0.70, `${(desktop.mapRatio*100).toFixed(1)}%`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const mobile = await page.evaluate(() => {
    const m = document.querySelector('.qea-mapcol').getBoundingClientRect();
    const l = document.querySelector('.qea-listcol').getBoundingClientRect();
    return {
      stacked: l.top >= m.bottom - 2,
      mapHeight: m.height,
      noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  check('mobile: list sits below map', mobile.stacked);
  check('mobile: map has sane fixed height', mobile.mapHeight > 250 && mobile.mapHeight < 450, `${mobile.mapHeight}px`);
  check('mobile: no horizontal scrolling', mobile.noHScroll);

  await page.click('.qea-card[data-slug="ziptrek"]');
  await page.waitForTimeout(400);
  check('mobile: selection still opens correct popup', (await popupTitle(page)) === 'Ziptrek Ecotours');

  // ---------------------------------------------------------------
  console.log('\n[9] Double-init guard & JS errors');
  const doubleInit = await page.evaluate(() => {
    const before = document.querySelectorAll('.qea-marker').length;
    initQeaStoriesMap({});
    return { before, after: document.querySelectorAll('.qea-marker').length };
  });
  check('re-running init does not duplicate markers', doubleInit.before === doubleInit.after,
    `${doubleInit.before} -> ${doubleInit.after}`);
  check('no uncaught JS errors', page._errors.length === 0, page._errors.slice(0, 3).join(' | '));

  // ---------------------------------------------------------------
  // Everything below runs against tests/cms-variants.html, a fixture of
  // the awkward rows the live QEA Collection actually contains. See the
  // comment at the top of that file before tidying it.
  console.log('\n[10] Real-CMS quirks');
  const variantsUrl = (process.env.QEA_VARIANTS_URL ||
    BASE.replace(/[^/]*$/, '') + 'tests/cms-variants.html');
  const vpage = await newPage(browser, variantsUrl);
  const vstories = await vpage.evaluate(() =>
    document.querySelector('#qea-stories-map').__qeaStoriesInstance.stories);
  const byslug = Object.fromEntries(vstories.map(s => [s.slug, s]));

  // The live page emits data-tech; earlier builds only read
  // data-technologies, which left the technology filter empty.
  check('data-tech is read as technologies',
    byslug['sasha-in-alexandra'].technologies.join() === 'Solar',
    JSON.stringify(byslug['sasha-in-alexandra'].technologies));

  const techChips = await vpage.$$eval('[data-group="tech"] .qea-chip',
    els => els.map(e => e.dataset.value).filter(v => v !== '__all__'));
  check('case variants collapse to one technology chip',
    techChips.filter(v => v.toLowerCase() === 'solar').length === 1,
    techChips.join(' | '));
  check('two-word tag case variants collapse too',
    techChips.filter(v => v.toLowerCase() === 'commercial kitchen').length === 1,
    techChips.join(' | '));
  check('canonical spelling comes from the preferred order',
    techChips.includes('Solar') && techChips.includes('Commercial Kitchen'),
    techChips.join(' | '));

  const typeChips = await vpage.$$eval('[data-group="type"] .qea-chip',
    els => els.map(e => e.dataset.value).filter(v => v !== '__all__'));
  check('type case and trailing space collapse to one chip',
    typeChips.filter(v => v.toLowerCase() === 'business').length === 1,
    typeChips.join(' | '));

  // The point of folding the spellings: a filter click has to catch the
  // rows that spelled the tag differently.
  await vpage.evaluate(() =>
    document.querySelector('#qea-stories-map').__qeaStoriesInstance.setFilter('tech', 'Solar'));
  await vpage.waitForTimeout(300);
  const solarCards = await visibleCards(vpage);
  check('filtering Solar catches the "solar " row',
    solarCards.includes('sasha-in-alexandra') && solarCards.includes('queenstown-ice-arena'),
    solarCards.join(','));

  await vpage.evaluate(() =>
    document.querySelector('#qea-stories-map').__qeaStoriesInstance.setFilter('tech', '__all__'));
  await vpage.waitForTimeout(300);

  check('a tag spelled twice in one row renders one pill',
    (await vpage.$$eval('.qea-card[data-slug="electric-cherries"] .qea-pill--tech',
      els => els.map(e => e.textContent.trim()))).filter(t => t === 'Solar').length === 1);

  // Transposed Latitude/Longitude — recovered rather than dropped.
  const milford = byslug['milford-infrastructure'];
  check('transposed lat/lng is recovered', milford.hasLocation === true &&
    Math.abs(milford.lat - -44.6711) < 1e-6 && Math.abs(milford.lng - 167.9192) < 1e-6,
    `${milford.lat}, ${milford.lng}`);
  check('recovered row gets a marker',
    (await visibleMarkers(vpage)).includes('milford-infrastructure'));

  // Still-correct behaviour that the swap must not have loosened.
  check('blank coordinates still mean no marker',
    byslug['story-without-a-pin'].hasLocation === false &&
    !(await visibleMarkers(vpage)).includes('story-without-a-pin'));
  check('story without coordinates still lists',
    (await visibleCards(vpage)).includes('story-without-a-pin'));
  check('empty data-tech lists with no technology pills',
    byslug['ifly-queenstown'].technologies.length === 0 &&
    (await visibleCards(vpage)).includes('ifly-queenstown'));
  check('no uncaught JS errors on the variants fixture',
    vpage._errors.length === 0, vpage._errors.slice(0, 3).join(' | '));

  // ---------------------------------------------------------------
  // The component is sized by its host box: Webflow sets the height on
  // the Embed and the component follows, with --qea-min-height as the
  // floor for an auto-height container.
  console.log('\n[11] Host-driven sizing');
  const spage = await newPage(browser, BASE);
  const box = () => spage.evaluate(() => {
    const el = document.querySelector('#qea-stories-map');
    const map = document.querySelector('.qea-map');
    const list = document.querySelector('.qea-listcol');
    return {
      root: Math.round(el.getBoundingClientRect().height),
      rootW: Math.round(el.getBoundingClientRect().width),
      parentW: (() => { const p = el.parentElement, cs = getComputedStyle(p);
        return Math.round(p.getBoundingClientRect().width
          - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); })(),
      map: Math.round(map.getBoundingClientRect().height),
      list: Math.round(list.getBoundingClientRect().height),
      canvas: Math.round((document.querySelector('.qea-map canvas') || {getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height),
    };
  });

  const auto = await box();
  check('auto-height container falls back to --qea-min-height',
    auto.root === 560, `${auto.root}px`);
  check('component fills its container width',
    auto.rootW === auto.parentW, `${auto.rootW} vs ${auto.parentW}`);

  // A taller host box: the component should grow into it, not stay 560.
  await spage.evaluate(() => {
    document.querySelector('#qea-stories-map').parentElement.style.height = '900px';
  });
  await spage.waitForTimeout(600);
  const tall = await box();
  check('fills a container taller than the floor', tall.root === 900, `${tall.root}px`);
  check('map column grows with the container', tall.map > auto.map,
    `${auto.map} -> ${tall.map}`);
  check('list column grows with the container', tall.list > auto.list,
    `${auto.list} -> ${tall.list}`);
  check('map canvas re-measures on container resize',
    Math.abs(tall.canvas - tall.map) <= 2, `canvas ${tall.canvas} vs map ${tall.map}`);

  // A shorter host box only wins once the floor is lifted — that is the
  // documented escape hatch, and the floor exists so an unstyled
  // container can't collapse the map to nothing.
  await spage.evaluate(() => {
    document.querySelector('#qea-stories-map').parentElement.style.height = '400px';
  });
  await spage.waitForTimeout(400);
  check('floor still applies to a short container', (await box()).root === 560);

  await spage.evaluate(() => {
    document.querySelector('#qea-stories-map').style.setProperty('--qea-min-height', '0px');
  });
  await spage.waitForTimeout(600);
  const short = await box();
  check('--qea-min-height: 0 lets a short container win', short.root === 400, `${short.root}px`);
  check('map canvas re-measures when shrinking',
    Math.abs(short.canvas - short.map) <= 2, `canvas ${short.canvas} vs map ${short.map}`);

  // Mobile: the map takes its slice off the top and the list takes the
  // rest of the same box, instead of running on down the page.
  await spage.setViewportSize({ width: 390, height: 844 });
  await spage.evaluate(() => {
    const el = document.querySelector('#qea-stories-map');
    el.style.removeProperty('--qea-min-height');
    el.parentElement.style.height = '700px';
  });
  await spage.waitForTimeout(600);
  const mob = await box();
  // Mobile deliberately opts out of filling the box: the filter chips
  // wrap to ~280px at phone width, so a fixed height leaves the list a
  // few dozen pixels. The host height becomes a minimum instead.
  check('mobile grows past a fixed container rather than cramping the list',
    mob.root > 700, `${mob.root}px`);
  check('mobile map keeps its fixed slice', mob.map >= 330 && mob.map <= 350, `${mob.map}px`);
  check('mobile list is not reduced to a sliver', mob.list > 600,
    `list ${mob.list} in ${mob.root}`);
  check('mobile list does not become a nested scroll region',
    (await spage.evaluate(() => getComputedStyle(document.querySelector('.qea-list')).overflowY)) === 'visible');
  check('no uncaught JS errors while resizing', spage._errors.length === 0,
    spage._errors.slice(0, 3).join(' | '));

  // ---------------------------------------------------------------
  // The iframe build: embed.html has no CMS list of its own, so the
  // parent page reads its Collection and posts the rows in.
  console.log('\n[12] Iframe bridge');
  const parentUrl = (process.env.QEA_PARENT_URL ||
    BASE.replace(/[^/]*$/, '') + 'tests/iframe-parent.html');
  const ppage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const perrors = [];
  ppage.on('pageerror', e => perrors.push(e.message));
  await ppage.goto(parentUrl, { waitUntil: 'load' });
  const frame = ppage.frameLocator('#qea-stories-frame');
  let bridged = true;
  try {
    await frame.locator('.qea-card').first().waitFor({ timeout: 15000 });
  } catch (e) { bridged = false; }
  check('parent posts stories into the iframe', bridged);

  if (bridged) {
    await ppage.waitForTimeout(1200);
    const inFrame = await ppage.frames().find(f => f.url().includes('embed.html'))
      .evaluate(() => {
        const inst = document.querySelector('#qea-stories-map').__qeaStoriesInstance;
        const byId = Object.fromEntries(inst.stories.map(s => [s.slug, s]));
        return {
          count: inst.stories.length,
          cards: document.querySelectorAll('.qea-card').length,
          sasha: byId['sasha-in-alexandra'],
          milford: byId['milford-infrastructure'],
          techChips: [...document.querySelectorAll('[data-group="tech"] .qea-chip')]
            .map(e => e.dataset.value).filter(v => v !== '__all__'),
          rootH: Math.round(document.querySelector('#qea-stories-map').getBoundingClientRect().height),
        };
      });

    check('every story crosses the bridge', inFrame.count === 3, `${inFrame.count}`);
    check('cards render inside the iframe', inFrame.cards === 3, `${inFrame.cards}`);
    check('short fields arrive', inFrame.sasha.title === 'Sasha in Alexandra' &&
      /power bill/.test(inFrame.sasha.summary), JSON.stringify(inFrame.sasha.summary));
    check('data-blurb is used as the summary', !!inFrame.sasha.summary);
    check('rich text is paired with the right story',
      /Glance A/.test(inFrame.sasha.glance) && /Journey A/.test(inFrame.sasha.journey),
      JSON.stringify(inFrame.sasha.glance));
    check('component props arrive (image, quote, link)',
      /a\.png$/.test(inFrame.sasha.image) && inFrame.sasha.quote === 'Quote A',
      `${inFrame.sasha.image} | ${inFrame.sasha.quote}`);
    // Index alignment is the risky part of the bridge: if it slipped,
    // a story would show another story's text and look plausible.
    check('second story gets its own text, not the first\'s',
      /Glance B/.test(inFrame.milford.glance) &&
      !/Glance A/.test(inFrame.milford.glance),
      JSON.stringify(inFrame.milford.glance));
    check('canonicalisation still runs on bridged rows',
      inFrame.techChips.filter(v => v.toLowerCase() === 'solar').length === 1,
      inFrame.techChips.join(' | '));
    check('transposed coordinates still recovered over the bridge',
      inFrame.milford.hasLocation === true &&
      Math.abs(inFrame.milford.lat - -44.6711) < 1e-6,
      `${inFrame.milford.lat}, ${inFrame.milford.lng}`);
    check('iframe page fills the frame', inFrame.rootH >= 690 && inFrame.rootH <= 700,
      `${inFrame.rootH}px`);

    // Selection has to travel back up so the parent can keep the URL.
    await frame.locator('.qea-card[data-slug="milford-infrastructure"]').click();
    await ppage.waitForTimeout(700);
    check('selection is posted back to the parent',
      (await ppage.evaluate(() => window.__qeaLastStory)) === 'milford-infrastructure',
      String(await ppage.evaluate(() => window.__qeaLastStory)));
  }

  check('no uncaught JS errors on the parent page', perrors.length === 0,
    perrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
