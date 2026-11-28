import { expect, test, type Page } from '@playwright/test';

/**
 * T0023: the HUD in the real browser build. Speed, minimap and mission indicator are
 * shown, follow the game state while driving, never overlap each other and log no errors.
 */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/** The player starts on foot beside the sports car (T0026): press F to get in. */
async function enterCar(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__neon.player?.grounded === true, null, { timeout: 30_000 });
  await page.locator('canvas#game').focus();
  await page.keyboard.press('KeyF');
  await page.waitForFunction(
    () => window.__neon.player?.state === 'inVehicle' && window.__neon.vehicle,
    null,
    {
      timeout: 30_000,
    },
  );
}

async function boxesOverlap(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = [
      '.debug-overlay',
      '.speedo',
      '.hud-minimap',
      '.hud-status',
      '.hud-mission',
      '.hud-banner',
      '.title',
    ];
    const boxes = sel
      .map((s) => ({ s, el: document.querySelector<HTMLElement>(s) }))
      .filter((b) => b.el && !b.el.hidden && b.el.offsetParent !== null)
      .map((b) => ({ s: b.s, r: b.el!.getBoundingClientRect() }));
    const out: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i]!;
      if (a.r.left < 0 || a.r.top < 0 || a.r.right > innerWidth || a.r.bottom > innerHeight)
        out.push(`${a.s} leaves the viewport`);
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j]!;
        const hit =
          a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom;
        if (hit) out.push(`${a.s} overlaps ${b.s}`);
      }
    }
    return out;
  });
}

test('HUD shows speed, minimap position and the mission objective, and tracks the car', async ({ page }) => {
  test.setTimeout(150_000); // SwiftShader renders only a few frames per second
  const problems = collectProblems(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__neon?.phase === 'running' && window.__neon.ticks > 60, null, {
    timeout: 45_000,
  });

  // On foot: minimap and mission panel, centred on the player; no speedometer.
  await expect(page.locator('.hud-minimap canvas')).toBeVisible();
  await expect(page.locator('.hud-mission')).toBeVisible();
  await expect(page.locator('.speedo')).toBeHidden();
  const onFoot = await page.evaluate(() => ({ ...window.__neon.hud, p: window.__neon.player! }));
  expect(onFoot.speed).toBeNull();
  expect(onFoot.mapX).toBeCloseTo(onFoot.p.x, 1);
  expect(onFoot.mapZ).toBeCloseTo(onFoot.p.z, 1);

  await enterCar(page);
  await expect(page.locator('.speedo')).toBeVisible();
  await expect(page.locator('.hud-mission-title')).toHaveText('WARM-UP LAP');
  await expect(page.locator('.hud-mission-step')).toHaveText('1/6');
  await expect(page.locator('.hud-mission-objective')).toContainText('checkpoint');
  await expect(page.locator('.hud-mission-distance')).toHaveText(/^\d+ m$/);
  expect(await boxesOverlap(page)).toEqual([]);

  const start = await page.evaluate(() => ({ ...window.__neon.hud, v: window.__neon.vehicle! }));
  expect(start.speed).toBe('0');
  expect(start.mapX).toBeCloseTo(start.v.x, 3);
  expect(start.mapZ).toBeCloseTo(start.v.z, 3);
  const mapBefore = await page
    .locator('.hud-minimap canvas')
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await test.info().attach('hud-start.png', { body: await page.screenshot(), contentType: 'image/png' });

  // Drive north up the arterial towards the first checkpoint.
  await page.locator('canvas#game').focus();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => (window.__neon.vehicle?.speedKmh ?? 0) > 30, null, { timeout: 30_000 });
  const moving = await page.evaluate(() => ({
    hud: { ...window.__neon.hud },
    v: { ...window.__neon.vehicle! },
    shown: document.querySelector('.speedo-speed')!.textContent,
    timer: document.querySelector('.hud-mission-timer')!.textContent,
  }));
  // The speedometer shows the car's real speed, and the minimap is centred on the car.
  expect(Number(moving.shown)).toBeGreaterThan(20);
  expect(Math.abs(Number(moving.shown) - moving.v.speedKmh)).toBeLessThan(15);
  expect(moving.hud.mapZ).toBeLessThan(start.v.z - 2);
  expect(Math.abs(moving.hud.mapZ! - moving.v.z)).toBeLessThan(5);
  expect(moving.timer).toMatch(/^\d+:\d\d\.\d$/);
  const mapAfter = await page
    .locator('.hud-minimap canvas')
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(mapAfter).not.toBe(mapBefore);

  // Reaching the first checkpoint advances the mission indicator.
  await page.waitForFunction(() => document.querySelector('.hud-mission-step')?.textContent === '2/6', null, {
    timeout: 40_000,
  });
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS');
  await page.waitForFunction(() => Math.abs(window.__neon.vehicle!.speedKmh) < 3, null, { timeout: 30_000 });
  await page.keyboard.up('KeyS');
  await test.info().attach('hud-step2.png', { body: await page.screenshot(), contentType: 'image/png' });
  expect(await boxesOverlap(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('HUD elements never overlap or leave the screen at common window sizes', async ({ page }) => {
  const problems = collectProblems(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__neon?.phase === 'running' && window.__neon.frames > 5, null, {
    timeout: 45_000,
  });
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [1280, 720],
    [1024, 768],
    [900, 600],
    [800, 500],
  ] as const) {
    await page.setViewportSize({ width, height });
    const f = await page.evaluate(() => window.__neon.frames);
    await page.waitForFunction((n) => window.__neon.frames > n + 2, f, { timeout: 20_000 });
    expect(await boxesOverlap(page), `${width}x${height}`).toEqual([]);
    // The minimap canvas backing store follows its CSS size (sharp, not stretched).
    const m = await page.locator('.hud-minimap canvas').evaluate((c: HTMLCanvasElement) => ({
      w: c.width,
      css: c.getBoundingClientRect().width,
      dpr: devicePixelRatio,
    }));
    expect(Math.abs(m.w - m.css * m.dpr)).toBeLessThanOrEqual(1);
  }
  await test.info().attach('hud-800x500.png', { body: await page.screenshot(), contentType: 'image/png' });
  expect(problems).toEqual([]);
});

test('health and wanted stars: stars light up when the car crashes, health is shown', async ({ page }) => {
  test.setTimeout(150_000);
  const problems = collectProblems(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__neon?.phase === 'running' && window.__neon.ticks > 60, null, {
    timeout: 45_000,
  });
  await expect(page.locator('.hud-status')).toBeVisible();
  await expect(page.locator('.hud-star')).toHaveCount(5);
  await expect(page.locator('.hud-star.hud-star-on')).toHaveCount(0);
  await expect(page.locator('.hud-wanted')).toHaveAttribute('aria-label', 'Wanted level 0');
  await expect(page.locator('.hud-health-text').first()).toHaveText('100');
  expect(await page.evaluate(() => window.__neon.hud.wanted)).toBe(0);
  expect(await page.evaluate(() => window.__neon.collisions)).toBe(0);

  // Get in, pick up speed, then steer right: the car leaves the arterial (which has no
  // other traffic) and hits the kerb and buildings on its east side.
  await enterCar(page);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => (window.__neon.vehicle?.speedKmh ?? 0) > 35, null, { timeout: 30_000 });
  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => window.__neon.collisions > 0, null, { timeout: 90_000 });
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  await page.waitForFunction(() => (window.__neon.hud.wanted ?? 0) >= 1, null, { timeout: 10_000 });
  const after = await page.evaluate(() => ({
    wanted: window.__neon.hud.wanted!,
    lit: document.querySelectorAll('.hud-star.hud-star-on').length,
    label: document.querySelector('.hud-wanted')!.getAttribute('aria-label'),
    health: window.__neon.hud.health!,
    shownHealth: Number(document.querySelector('.hud-health-text')!.textContent),
  }));
  expect(after.wanted).toBeGreaterThanOrEqual(1);
  expect(after.lit).toBe(after.wanted);
  expect(after.label).toBe(`Wanted level ${after.wanted}`);
  expect(after.shownHealth).toBe(after.health);
  expect(after.health).toBeGreaterThan(0);
  expect(after.health).toBeLessThanOrEqual(100);
  await test.info().attach('hud-wanted.png', { body: await page.screenshot(), contentType: 'image/png' });
  expect(await boxesOverlap(page)).toEqual([]);
  expect(problems).toEqual([]);
});
