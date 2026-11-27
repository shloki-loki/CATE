import { expect, test, type Page } from '@playwright/test';

/**
 * T0025: the standalone `Vehicle` class in the browser test arena (arena.html), driven
 * from a plain GameLoop without the ECS. SwiftShader is slow, so tests wait on simulated
 * time rather than wall-clock time.
 */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return problems;
}

test('arena: 30-second scripted drive with the Vehicle class, no runtime errors', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watchProblems(page);
  await page.goto('/arena.html?autodrive');
  await expect(page.locator('canvas#game')).toBeVisible();
  await page.waitForFunction(() => window.__arena?.phase === 'running', null, { timeout: 45_000 });

  // Sample the car while the script runs, then wait for the whole 30 s of simulated driving.
  const samples: { t: number; step: string; speedKmh: number; x: number; z: number }[] = [];
  const deadline = Date.now() + 220_000;
  for (;;) {
    const s = await page.evaluate(() => ({ ...window.__arena, vehicle: { ...window.__arena.vehicle } }));
    samples.push({
      t: s.simTime,
      step: s.step,
      speedKmh: s.vehicle.speedKmh,
      x: s.vehicle.x,
      z: s.vehicle.z,
    });
    if (s.done || s.error || Date.now() > deadline) break;
    await page.waitForTimeout(500);
  }
  const end = await page.evaluate(() => ({ ...window.__arena, vehicle: { ...window.__arena.vehicle } }));
  await test.info().attach('arena-status.json', {
    body: JSON.stringify({ end, samples }, null, 2),
    contentType: 'application/json',
  });
  const shot = await page.locator('canvas#game').screenshot();
  await test.info().attach('arena.png', { body: shot, contentType: 'image/png' });

  expect(end.error).toBeNull();
  expect(end.done).toBe(true);
  expect(end.simTime).toBeGreaterThanOrEqual(30);
  expect(end.frames).toBeGreaterThan(10);
  expect(end.maxKmh).toBeGreaterThan(40); // drove forward
  expect(end.minKmh).toBeLessThan(-20); // reversed
  expect(end.turnedRight).toBeLessThan(-1); // steered right
  expect(end.turnedLeft).toBeGreaterThan(1); // steered left
  expect(end.minUpY).toBeGreaterThan(0.9); // stayed on its wheels
  expect(end.maxSyncError).toBeLessThan(1e-3); // mesh always between the last two physics positions
  expect(Math.abs(end.vehicle.speedKmh)).toBeLessThan(4); // handbrake stopped it
  expect(Number.isFinite(end.vehicle.x + end.vehicle.y + end.vehicle.z)).toBe(true);
  // The car really moved away from the start point (30, -70).
  expect(samples.some((s) => Math.hypot(s.x - 30, s.z + 70) > 20)).toBe(true);
  await expect(page.locator('.fatal')).toHaveCount(0);
  await expect(page.locator('.speedo')).toBeVisible();
  expect(problems).toEqual([]);
});

test('arena: keyboard drives the Vehicle forward, steers it and reverses it', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.goto('/arena.html?car=compact');
  await page.waitForFunction(() => window.__arena?.phase === 'running' && window.__arena.ticks > 30, null, {
    timeout: 45_000,
  });
  const start = await page.evaluate(() => ({ ...window.__arena.vehicle }));
  expect(Math.abs(start.speedKmh)).toBeLessThan(1);
  await page.locator('canvas#game').focus();

  // W: forward is +Z at the start heading.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__arena.vehicle.speedKmh > 20, null, { timeout: 30_000 });
  const moving = await page.evaluate(() => ({ ...window.__arena.vehicle }));
  expect(moving.z).toBeGreaterThan(start.z + 2);

  // D: steer right, heading decreases.
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__arena.turnedRight < -0.5, null, { timeout: 30_000 });
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');

  // S: brake to a stop, keep holding to reverse.
  await page.keyboard.down('KeyS');
  await page.waitForFunction(() => window.__arena.vehicle.speedKmh < -5, null, { timeout: 40_000 });
  await page.keyboard.up('KeyS');
  const end = await page.evaluate(() => ({ ...window.__arena }));
  expect(end.vehicle.gear).toBe(-1);
  expect(end.error).toBeNull();
  expect(end.minUpY).toBeGreaterThan(0.9);
  expect(end.maxSyncError).toBeLessThan(1e-3);
  expect(problems).toEqual([]);
});
