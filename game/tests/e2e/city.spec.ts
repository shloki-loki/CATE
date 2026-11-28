import { expect, test } from '@playwright/test';

/**
 * T0027: the procedural city in the real browser build. It must be generated, meshed and
 * loaded into physics within 5 seconds of opening the page, render, and log no errors.
 */
test('the procedural city loads within 5 seconds and renders', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await page.waitForFunction(() => window.__neon?.phase === 'running' && window.__neon.frames > 3, null, {
    timeout: 45_000,
  });
  const s = await page.evaluate(() => ({ city: window.__neon.city, bodies: window.__neon.bodies }));
  test.info().annotations.push({ type: 'city', description: JSON.stringify(s.city) });
  console.log(`city: ${JSON.stringify(s.city)}`);
  expect(s.city).not.toBeNull();
  expect(s.city!.buildings).toBeGreaterThan(150);
  expect(s.city!.chunks).toBeGreaterThan(1);
  // Generate + meshes + colliders, and the whole time from navigation until the city was in the scene.
  expect(s.city!.loadMs).toBeLessThan(5000);
  expect(s.city!.readyAtMs).toBeLessThan(5000);
  expect(s.bodies).toBeGreaterThan(s.city!.buildings);

  const shot = await page.locator('canvas#game').screenshot();
  await test.info().attach('city.png', { body: shot, contentType: 'image/png' });
  expect(problems).toEqual([]);
});
