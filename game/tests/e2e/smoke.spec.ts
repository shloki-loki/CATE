import { expect, test } from '@playwright/test';

/**
 * Smoke test (T0016 §1 "Tests"): the production build boots, the WebGL2 scene
 * renders real pixels, the simulation ticks, and there are no console errors.
 */
test('game boots, renders the scene and logs no errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });

  await page.goto('/');
  await expect(page.locator('canvas#game')).toBeVisible();

  // Wait for the loop to run for a while (SwiftShader is slow, so allow time).
  await page.waitForFunction(() => window.__neon?.phase === 'running' && window.__neon.frames > 30, null, {
    timeout: 45_000,
  });
  const status = await page.evaluate(() => ({ ...window.__neon }));
  expect(status.error).toBeNull();
  expect(status.ticks).toBeGreaterThan(0);
  expect(status.drawCalls).toBeGreaterThan(10);
  expect(status.triangles).toBeGreaterThan(1000);
  expect(status.bodies).toBeGreaterThan(10);
  await expect(page.locator('.fatal')).toHaveCount(0);
  await expect(page.locator('.debug-overlay')).toContainText('fps');

  // The canvas must show a real scene, not a blank clear colour: decode a
  // screenshot in the page and measure colour variety and contrast.
  const shot = await page.locator('canvas#game').screenshot();
  await test.info().attach('scene.png', { body: shot, contentType: 'image/png' });
  const stats = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const buckets = new Set<number>();
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      buckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += l;
      sum2 += l * l;
      n++;
    }
    const mean = sum / n;
    return { colours: buckets.size, lumaStd: Math.sqrt(sum2 / n - mean * mean), w: c.width, h: c.height };
  }, shot.toString('base64'));
  expect(stats.w).toBeGreaterThan(100);
  expect(stats.colours).toBeGreaterThan(40);
  expect(stats.lumaStd).toBeGreaterThan(15);

  // Resize must not break rendering.
  await page.setViewportSize({ width: 900, height: 600 });
  const before = await page.evaluate(() => window.__neon.frames);
  await page.waitForFunction((f) => window.__neon.frames > f + 5, before, { timeout: 20_000 });

  expect(problems).toEqual([]);
});

/**
 * T0020: the player's car responds to the keyboard in the real browser build
 * (after getting in with F, T0026).
 * SwiftShader runs only a few frames per second, so thresholds are generous and
 * we wait on game state rather than wall-clock time.
 */
test('the player car drives, steers and brakes from keyboard input', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await page.waitForFunction(
    () => window.__neon?.phase === 'running' && window.__neon.ticks > 60 && window.__neon.player?.grounded,
    null,
    { timeout: 45_000 },
  );
  // T0026: the player starts on foot beside the sports car; F gets in.
  expect(await page.evaluate(() => window.__neon.vehicle)).toBeNull();
  await page.locator('canvas#game').focus();
  await page.keyboard.press('KeyF');
  await page.waitForFunction(
    () => window.__neon.player?.state === 'inVehicle' && window.__neon.vehicle,
    null,
    {
      timeout: 30_000,
    },
  );
  const start = await page.evaluate(() => window.__neon.vehicle);
  expect(start).not.toBeNull();
  expect(Math.abs(start!.speedKmh)).toBeLessThan(1); // parked at boot
  expect(start!.upY).toBeGreaterThan(0.99);
  await expect(page.locator('.speedo')).toBeVisible();

  // Throttle: the car faces -Z at boot, so driving forward lowers z.
  await page.locator('canvas#game').focus();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => (window.__neon.vehicle?.speedKmh ?? 0) > 25, null, { timeout: 30_000 });
  const moving = await page.evaluate(() => window.__neon.vehicle!);
  expect(moving.z).toBeLessThan(start!.z - 2);
  await expect(page.locator('.speedo-speed')).not.toHaveText('0');

  // Steer right while driving: heading decreases (atan2(fwd.x, fwd.z) convention).
  const h0 = moving.heading;
  await page.keyboard.down('KeyD');
  await page.waitForFunction(
    (h) => {
      const v = window.__neon.vehicle!;
      const d = Math.atan2(Math.sin(v.heading - h), Math.cos(v.heading - h));
      return d < -0.3;
    },
    h0,
    { timeout: 30_000 },
  );
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');

  // Brake to a stop.
  await page.keyboard.down('KeyS');
  await page.waitForFunction(() => Math.abs(window.__neon.vehicle!.speedKmh) < 2, null, { timeout: 30_000 });
  await page.keyboard.up('KeyS');
  const end = await page.evaluate(() => window.__neon.vehicle!);
  expect(end.upY).toBeGreaterThan(0.9);
  expect(Number.isFinite(end.x + end.y + end.z)).toBe(true);
  const shot = await page.locator('canvas#game').screenshot();
  await test.info().attach('driving.png', { body: shot, contentType: 'image/png' });

  // F again: out of the car, on foot beside it, and the follow camera is back on the player.
  await page.keyboard.press('KeyF');
  await page.waitForFunction(
    () => window.__neon.player?.state !== 'inVehicle' && window.__neon.player?.grounded,
    null,
    { timeout: 30_000 },
  );
  expect(await page.evaluate(() => window.__neon.vehicle)).toBeNull();
  const out = await page.evaluate(() => ({ p: window.__neon.player!, c: window.__neon.camera! }));
  expect(Math.hypot(out.p.x - end.x, out.p.z - end.z)).toBeLessThan(3.5);
  await page.waitForTimeout(1500);
  const settled = await page.evaluate(() => ({ p: window.__neon.player!, c: window.__neon.camera! }));
  expect(Math.hypot(settled.c.x - settled.p.x, settled.c.z - settled.p.z)).toBeLessThan(10);
  await test.info().attach('got-out.png', {
    body: await page.locator('canvas#game').screenshot(),
    contentType: 'image/png',
  });
  expect(problems).toEqual([]);
});
