import { expect, test, type Page } from '@playwright/test';

interface Handle {
  state: string;
  stats(): Record<string, number | string> | null;
  sampleFrame(): number;
  placeBelow(): { x: number; y: number; z: number; value: number } | null;
  blockAt(x: number, y: number, z: number): number;
  saveNow(): Promise<void>;
  debug(): string[];
}

declare global {
  interface Window {
    __stratavale: Handle;
  }
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('title screen renders', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?test=1');
  await expect(page.getByText('Singleplayer')).toBeVisible();
  await expect(page.locator('.title')).toHaveText(/STRATAVALE/);
  await page.screenshot({ path: 'test-results/title.png' });
  expect(errors).toEqual([]);
});

test('world generates, renders and persists edits', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?test=1&autostart=1&fresh=1&seed=smoke&rd=4&world=smoke');
  await page.waitForFunction(() => window.__stratavale?.state === 'playing', null, { timeout: 60_000 });
  await page.waitForFunction(() => Number(window.__stratavale.stats()?.chunksMeshed) >= 40, null, {
    timeout: 60_000,
  });
  // Let a few frames render with the final meshes.
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/smoke.png' });
  const colours = await page.evaluate(() => window.__stratavale.sampleFrame());
  expect(colours).toBeGreaterThan(16);

  const placed = await page.evaluate(() => window.__stratavale.placeBelow());
  expect(placed).not.toBeNull();
  await page.evaluate(() => window.__stratavale.saveNow());

  await page.goto('/?test=1&autostart=1&rd=4&world=smoke');
  await page.waitForFunction(() => window.__stratavale?.state === 'playing', null, { timeout: 60_000 });
  const after = await page.evaluate(({ x, y, z }) => window.__stratavale.blockAt(x, y, z), placed!);
  expect(after).toBe(placed!.value);
  expect(errors).toEqual([]);
});

test('water flows from a placed source and renders', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?test=1&autostart=1&fresh=1&seed=fluids&rd=4&world=fluids');
  await page.waitForFunction(() => window.__stratavale?.state === 'playing', null, { timeout: 60_000 });
  const WATER = 9 << 4;
  const STONE = 1 << 4;
  const info = await page.evaluate(
    ({ WATER, STONE }) => {
      const h = window.__stratavale as unknown as {
        player(): { x: number; z: number };
        height(x: number, z: number): number;
        setBlock(x: number, y: number, z: number, v: number): boolean;
        teleport(x: number, y: number, z: number): void;
        look(yaw: number, pitch: number): void;
      };
      const p = h.player();
      const x = Math.floor(p.x) + 6;
      const z = Math.floor(p.z);
      const y = h.height(x, z) + 4;
      // A stone pillar with a platform, and a water source on top.
      for (let dy = -4; dy < 0; dy++) h.setBlock(x, y + dy, z, STONE);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) h.setBlock(x + dx, y, z + dz, STONE);
      h.setBlock(x, y + 1, z, WATER);
      h.teleport(x - 7, y + 3, z + 0.5);
      h.look(-Math.PI / 2, -0.35);
      return { x, y, z };
    },
    { WATER, STONE },
  );
  await page.waitForTimeout(4000);
  const spread = await page.evaluate(
    ({ x, y, z }) => window.__stratavale.blockAt(x + 1, y + 1, z) >> 4,
    info,
  );
  expect(spread).toBe(9);
  await page.screenshot({ path: 'test-results/fluids.png' });
  expect(errors).toEqual([]);
});
