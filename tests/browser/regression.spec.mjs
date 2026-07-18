import { expect, test } from '@playwright/test';

const TEST_STYLE = {
  version: 8,
  name: 'Deterministic test style',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9ede7' } }]
};

const WEATHER = {
  code: 0,
  data: {
    area_metadata: [
      { name: 'Marina South', label_location: { latitude: 1.28, longitude: 103.86 } },
      { name: 'Bedok', label_location: { latitude: 1.32, longitude: 103.93 } }
    ],
    items: [{
      valid_period: { text: '6:00 PM to 8:00 PM' },
      forecasts: [
        { area: 'Marina South', forecast: 'Thundery Showers' },
        { area: 'Bedok', forecast: 'Fair' }
      ]
    }]
  }
};

async function openArtifact(page, options = {}) {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const fixedNow = Date.parse('2026-07-18T10:00:00.000Z');
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...values) { super(...(values.length ? values : [fixedNow])); }
      static now() { return fixedNow; }
    }
    Object.defineProperty(window, 'Date', { configurable: true, value: FixedDate });
    const position = {
      coords: { latitude: 1.30, longitude: 103.85, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: 90, speed: 4 },
      timestamp: fixedNow
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: success => queueMicrotask(() => success(position)),
      watchPosition: success => { queueMicrotask(() => success(position)); return 1; },
      clearWatch() {}
    } });
    class MockDeviceOrientationEvent extends Event {
      constructor(type, init = {}) { super(type); Object.assign(this, { alpha: 90, beta: 0, gamma: 0, absolute: true }, init); }
      static async requestPermission() { return 'granted'; }
    }
    Object.defineProperty(window, 'DeviceOrientationEvent', { configurable: true, value: MockDeviceOrientationEvent });
  });
  await page.route('https://tiles.openfreemap.org/styles/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(TEST_STYLE)
  }));
  await page.route('**/*goatcounter*', route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'window.goatcounter = window.goatcounter || { count() {} };'
  }));
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  await page.route('https://api-open.data.gov.sg/**', route => route.fulfill(options.weatherFailure ? {
    status: 503,
    contentType: 'application/json',
    body: '{"code":503}'
  } : {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(WEATHER)
  }));
  if (options.graphFailure) {
    await page.route('**/data/graph.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
  }
  {
    await page.addInitScript(mode => {
      const messages = [];
      const worker = { postMessage: message => messages.push(message) };
      const registration = {
        waiting: ['waiting-update', 'first-install'].includes(mode) ? worker : null,
        installing: null,
        addEventListener() {},
        update: async () => {}
      };
      const listeners = new Map();
      const serviceWorker = {
        controller: mode === 'waiting-update' ? {} : null,
        register: async () => registration,
        addEventListener: (name, listener) => listeners.set(name, listener)
      };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
      window.__swTest = { messages, worker, registration, listeners };
    }, options.serviceWorkerMode || 'current');
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof map !== 'undefined' && Boolean(map.getLayer('closed-marker')));
  return runtimeErrors;
}

test('loads all critical layers, supports visibility controls, and restores them after a theme change', async ({ page }) => {
  const errors = await openArtifact(page);
  const requiredLayers = [
    'parks-fill', 'cpn-line', 'rail-open', 'pcn-line', 'risk-glow', 'closed-marker',
    'route-line', 'track-line', 'wx-zone-fill', 'racks-pt'
  ];
  await expect.poll(() => page.evaluate(ids => ids.every(id => Boolean(map.getLayer(id))), requiredLayers)).toBe(true);

  const cyclingToggle = page.getByRole('button', { name: 'Toggle Cycling paths' });
  if (await page.locator('#legend').evaluate(element => element.classList.contains('collapsed'))) {
    await page.locator('#lgHead').click();
  }
  await expect(cyclingToggle).toBeVisible();
  await cyclingToggle.click();
  await expect.poll(() => page.evaluate(() => map.getLayoutProperty('cpn-line', 'visibility'))).toBe('none');

  await page.getByRole('button', { name: 'Switch light or dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(ids => ids.every(id => Boolean(map.getLayer(id))), requiredLayers)).toBe(true);
  await expect.poll(() => page.evaluate(() => map.getLayoutProperty('cpn-line', 'visibility'))).toBe('none');
  expect(errors).toEqual([]);
});

test('shows deterministic weather and fails closed when the live API is unavailable', async ({ page, browser }) => {
  const errors = await openArtifact(page);
  await page.evaluate(() => loadWeather(true));
  await expect(page.locator('#wxRow')).toBeVisible();
  await expect(page.locator('#wxMain')).toHaveText('Thundery Showers');
  await expect(page.locator('#wxAdv')).toContainText('lightning risk');
  expect(errors).toEqual([]);

  const context = await browser.newContext({ serviceWorkers: 'block', colorScheme: 'light' });
  const failurePage = await context.newPage();
  const failureErrors = await openArtifact(failurePage, { weatherFailure: true });
  await failurePage.evaluate(() => loadWeather(true));
  await expect(failurePage.locator('#wxRow')).toBeHidden();
  await expect(failurePage.locator('#wxAdv')).toHaveAttribute('hidden', '');
  await expect(failurePage.locator('#wxAdv')).toHaveText('');
  expect(failureErrors.length).toBeGreaterThan(0);
  expect(failureErrors.every(message => message.includes('503 (Service Unavailable)'))).toBe(true);
  await context.close();
});

test('plans a fixed route, exposes the road warning, and reports missing routing data', async ({ page, browser }) => {
  const errors = await openArtifact(page);
  await page.getByRole('button', { name: 'Plan a route' }).click();
  await page.evaluate(() => {
    handleRouteClick([103.7859, 1.4370]);
    handleRouteClick([103.9040, 1.4043]);
  });
  await expect(page.locator('#rtOptions')).toBeVisible();
  await expect(page.locator('#rtOptions .rt-opt')).toHaveCount(2);
  await expect(page.locator('#rtDirs')).toBeVisible();
  await expect(page.locator('#rtDirs .rt-step').last()).toContainText('Arrive at destination');
  await expect(page.locator('#rtNotice')).toBeVisible();
  await expect(page.locator('#rtNotice')).toContainText('Uses roads');
  expect(errors).toEqual([]);

  const context = await browser.newContext({ serviceWorkers: 'block', colorScheme: 'light' });
  const failurePage = await context.newPage();
  const failureErrors = await openArtifact(failurePage, { graphFailure: true });
  await failurePage.getByRole('button', { name: 'Plan a route' }).click();
  await expect(failurePage.locator('#toast')).toContainText('Routing data isn’t available yet');
  expect(failureErrors.length).toBeGreaterThan(0);
  expect(failureErrors.every(message => message.includes('503 (Service Unavailable)'))).toBe(true);
  await context.close();
});

test('records location updates and generates a local GPX file', async ({ page }) => {
  const errors = await openArtifact(page);
  await page.waitForFunction(() => document.querySelectorAll('#lgBody .lrow').length >= 7);
  const gpx = await page.evaluate(() => {
    setLocActive(true);
    startRec();
    onPos({ coords: { latitude: 1.3000, longitude: 103.8000, accuracy: 5, heading: 90, speed: 4 }, timestamp: 1_000 });
    onPos({ coords: { latitude: 1.3001, longitude: 103.8001, accuracy: 5, heading: 90, speed: 4 }, timestamp: 2_000 });
    stopRec();
    return buildGPX();
  });
  await expect(page.locator('#viewSum')).toBeVisible();
  await expect(page.locator('#sumDist')).not.toHaveText('0.00');
  expect(gpx).toContain('<gpx version="1.1"');
  expect(gpx.match(/<trkpt /g)).toHaveLength(2);
  expect(gpx).toContain('lat="1.300100" lon="103.800100"');
  expect(errors).toEqual([]);
});

test('offers a waiting update only to an existing installation and never activates it automatically', async ({ page, browser }) => {
  const errors = await openArtifact(page, { serviceWorkerMode: 'waiting-update' });
  const pill = page.locator('#updatePill');
  await expect(pill).toBeVisible();
  expect(await page.evaluate(() => window.__swTest.messages)).toEqual([]);
  await pill.click();
  expect(await page.evaluate(() => window.__swTest.messages)).toEqual(['SKIP_WAITING']);
  expect(errors).toEqual([]);

  const context = await browser.newContext({ serviceWorkers: 'block', colorScheme: 'light' });
  const firstInstallPage = await context.newPage();
  const firstInstallErrors = await openArtifact(firstInstallPage, { serviceWorkerMode: 'first-install' });
  await expect(firstInstallPage.locator('#updatePill')).toBeHidden();
  expect(await firstInstallPage.evaluate(() => window.__swTest.messages)).toEqual([]);
  expect(firstInstallErrors).toEqual([]);
  await context.close();
});

test('keeps the responsive shell inside the viewport and keyboard-closes modal content', async ({ page }) => {
  const errors = await openArtifact(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'About this map' }).click();
  await expect(page.locator('#sheet')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});
