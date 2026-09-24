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
