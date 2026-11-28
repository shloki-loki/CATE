import { expect, test, type Page } from '@playwright/test';

/**
 * Character controller in the real browser build (T0021): keyboard moves the player,
 * Space jumps, the follow camera stays behind them, mouse drag turns the camera, and
 * nothing logs an error. Positions come from the read-only window.__neon status.
 */
type Vec = { x: number; y: number; z: number };

async function player(page: Page): Promise<Vec & { state: string; grounded: boolean }> {
  return page.evaluate(() => ({ ...window.__neon.player! }));
}
async function camera(page: Page): Promise<Vec> {
  return page.evaluate(() => ({ ...window.__neon.camera! }));
}
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('player walks, jumps and the camera follows', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await page.waitForFunction(
    () => window.__neon?.phase === 'running' && window.__neon.player?.grounded === true,
    null,
    { timeout: 45_000 },
  );
  const start = await player(page);
  expect(start.state).toBe('idle');
  const cam0 = await camera(page);
  expect(dist(cam0, start)).toBeGreaterThan(2);
  expect(dist(cam0, start)).toBeLessThan(7);
  expect(cam0.z).toBeGreaterThan(start.z); // spawn faces -Z, camera behind on +Z
  await test.info().attach('1-spawn.png', { body: await page.screenshot(), contentType: 'image/png' });

  // Hold W: the player runs forward (-Z) and the camera keeps up behind them.
  await page.keyboard.down('KeyW');
  await page.waitForFunction((z0) => window.__neon.player!.z < z0 - 4, start.z, { timeout: 30_000 });
  const mid = await player(page);
  expect(['run', 'walk', 'sprint']).toContain(mid.state);
  const camMid = await camera(page);
  await page.keyboard.up('KeyW');
  expect(dist(camMid, mid)).toBeLessThan(7);
  expect(camMid.z).toBeGreaterThan(mid.z);
  expect(Math.abs(mid.x - start.x)).toBeLessThan(0.5); // straight line
  await test.info().attach('2-running.png', { body: await page.screenshot(), contentType: 'image/png' });

  // Comes to rest and stays on the ground.
  await page.waitForFunction(() => window.__neon.player!.state === 'idle', null, { timeout: 15_000 });
  const rest = await player(page);

  // Space: jumps up and lands again.
  await page.keyboard.press('Space');
  await page.waitForFunction((y0) => window.__neon.player!.y > y0 + 0.5, rest.y, { timeout: 15_000 });
  await page.waitForFunction(() => window.__neon.player!.grounded, null, { timeout: 15_000 });
  expect(Math.abs((await player(page)).y - rest.y)).toBeLessThan(0.1);

  // Drag the mouse sideways: the camera orbits around the player.
  const box = (await page.locator('canvas#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx - i * 45, cy);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  const p2 = await player(page);
  const cam2 = await camera(page);
  // The camera has swung toward +X around the player.
  expect(cam2.x - p2.x).toBeGreaterThan(1);
  expect(dist(cam2, p2)).toBeLessThan(7);
  await test.info().attach('3-orbited.png', { body: await page.screenshot(), contentType: 'image/png' });

  expect(problems).toEqual([]);
});

test('walking into the parked car is blocked and does not shove it', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto('/');
  await page.waitForFunction(
    () => window.__neon?.phase === 'running' && window.__neon.player?.grounded === true,
    null,
    { timeout: 45_000 },
  );
  // The sports car faces -Z (1.9 m wide); the player stands 2.2 m to its -X (driver) side.
  const parked = await page.evaluate(() => ({ ...window.__neon.city!.playerCar }));
  const start = await player(page);
  expect(Math.abs(start.x - (parked.x - 2.2))).toBeLessThan(0.2);
  await page.locator('canvas#game').focus();
  await page.keyboard.down('KeyD'); // strafe right (+X): into the car's side
  await page.waitForFunction(
    (t0) => window.__neon.ticks > t0 + 120,
    await page.evaluate(() => window.__neon.ticks),
    {
      timeout: 30_000,
    },
  );
  const pushed = await player(page);
  await page.keyboard.up('KeyD');
  expect(pushed.x).toBeGreaterThan(start.x + 0.3); // walked up to it
  expect(pushed.x).toBeLessThan(parked.x - 0.95); // but never into it

  // The car is still where it was parked: get in and read its position.
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__neon.vehicle !== null, null, { timeout: 30_000 });
  const car = await page.evaluate(() => window.__neon.vehicle!);
  expect(Math.abs(car.x - parked.x)).toBeLessThan(0.3);
  expect(Math.abs(car.z - parked.z)).toBeLessThan(0.3);
  expect(problems).toEqual([]);
});
