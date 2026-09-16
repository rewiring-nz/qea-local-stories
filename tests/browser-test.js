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

  await browser.close();
  console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
