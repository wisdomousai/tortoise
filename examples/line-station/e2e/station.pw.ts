import { test, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../../../tests/e2e/service';

/**
 * Emit a keyboard-wedge burst the way a scanner does: physical key codes with Shift for capitals,
 * a couple of milliseconds apart, then Enter. Playwright's `keyboard` round-trips per key are too
 * slow to look like a scanner, and `keyboard.type` sends capitals without Shift, so the burst is
 * dispatched inside the page.
 */
async function wedge(page: Page, text: string) {
  await page.evaluate(async (value) => {
    const codes: Record<string, string> = { '-': 'Minus', '.': 'Period', '/': 'Slash' };
    const target = document.activeElement ?? document.body;
    const send = (key: string, code: string, shiftKey: boolean) => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key, code, shiftKey, bubbles: true, cancelable: true }),
      );
      target.dispatchEvent(
        new KeyboardEvent('keyup', { key, code, shiftKey, bubbles: true, cancelable: true }),
      );
    };
    for (const character of value) {
      const code = /[A-Za-z]/.test(character)
        ? `Key${character.toUpperCase()}`
        : /\d/.test(character)
          ? `Digit${character}`
          : codes[character];
      if (!code) throw new Error(`No key code for ${character}`);
      send(character, code, /[A-Z]/.test(character));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    send('Enter', 'Enter', false);
  }, text);
}

async function openKit(page: Page) {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-station-kit-'));
  const host = await startService('@agent-native/line-station', workspace);
  await page.goto(host.launchUrl);
  await expect(page.getByRole('link', { name: 'Stations', exact: true })).toBeVisible();
  await page.goto(`${host.origin}/#/station/kit`);
  await expect(page.getByRole('heading', { name: 'Operator kit' })).toBeVisible();
  return async () => {
    await host.stop();
    await rm(workspace, { recursive: true, force: true });
  };
}

test.describe('operator kit', () => {
  test('hold-to-confirm needs a full hold and cancels when the finger slides off', async ({
    page,
  }) => {
    const close = await openKit(page);
    try {
      const stop = page.getByRole('button', { name: /Request stop/ });
      await stop.scrollIntoViewIfNeeded();
      const box = (await stop.boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const status = page
        .getByRole('status')
        .filter({ hasText: /Running|Stopped/ })
        .first();

      // A tap does nothing.
      await page.mouse.click(center.x, center.y);
      await expect(status).toContainText('Running');

      // Sliding off mid-hold cancels, even though the button keeps pointer capture.
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await page.waitForTimeout(300);
      await page.mouse.move(center.x, box.y - 200);
      await page.waitForTimeout(900);
      await page.mouse.up();
      await expect(status).toContainText('Running');

      // A full hold confirms.
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await page.waitForTimeout(1_100);
      await page.mouse.up();
      await expect(status).toContainText('Stopped');
    } finally {
      await close();
    }
  });

  test('digit hotkeys pick tiles, paging moves pages, and a wedge scan fires no hotkey', async ({
    page,
  }) => {
    const close = await openKit(page);
    try {
      const picker = page.getByRole('group', { name: 'Stop reason' });
      await page.keyboard.press('3');
      await expect(picker.getByRole('button', { name: /Jam/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await page.keyboard.press('PageDown');
      await expect(page.getByText('Page 2 of 2')).toBeVisible();
      await page.keyboard.press('2');
      await expect(picker.getByRole('button', { name: /Downstream full/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.keyboard.press('PageUp');

      // A keyboard-wedge burst with digits: routed as an order, no tile picked by its digits.
      await wedge(page, 'ORD-12345');
      await expect(page.getByText('Recognized as order')).toBeVisible();
      // Keys within the burst window of the scan's Enter count as part of the burst; a person's
      // next key press comes later than that.
      await page.waitForTimeout(100);
      await page.keyboard.press('PageDown');
      await expect(picker.getByRole('button', { name: /Downstream full/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    } finally {
      await close();
    }
  });

  test('keypad entry shows the tolerance verdict before recording', async ({ page }) => {
    const close = await openKit(page);
    try {
      const pad = page.getByRole('group', { name: 'Measured length' });
      for (const key of ['1', '2', '0'])
        await pad.getByRole('button', { name: key, exact: true }).click();
      await pad.getByRole('button', { name: 'Decimal separator' }).click();
      await pad.getByRole('button', { name: '5', exact: true }).click();
      await expect(pad.locator('output')).toContainText('120,5');
      await expect(pad.getByText('Out of tolerance')).toBeVisible();
      await pad.getByRole('button', { name: 'Delete digit' }).click();
      for (const key of ['0', '5'])
        await pad.getByRole('button', { name: key, exact: true }).click();
      await expect(pad.getByText('In tolerance')).toBeVisible();
      await pad.getByRole('button', { name: /Record/ }).click();
      await expect(page.getByText('Recorded 120.05 mm')).toBeVisible();
    } finally {
      await close();
    }
  });

  test('taking over is one tap; handing back needs a hold', async ({ page }) => {
    const close = await openKit(page);
    try {
      await page.getByRole('button', { name: /Take over/ }).click();
      const handBack = page.getByRole('button', { name: /Hand back to agent/ });
      await expect(handBack).toBeVisible();
      await handBack.click();
      await expect(handBack).toBeVisible();
      await handBack.hover();
      await page.mouse.down();
      await page.waitForTimeout(1_100);
      await page.mouse.up();
      await expect(page.getByRole('button', { name: /Take over/ })).toBeVisible();
    } finally {
      await close();
    }
  });
});

/** Start the simulated station software as its own process; the bridge only sees its screen. */
async function startHmi() {
  const child = spawn(
    'bun',
    ['examples/line-station/fake-hmi/server.ts', '--port', '0', '--simulation-endpoints'],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const url = await new Promise<string>((resolveUrl, reject) => {
    let buffer = '';
    child.stdout!.on('data', (data) => {
      buffer += data.toString();
      const match = /listening on (http:\/\/\S+)/.exec(buffer);
      if (match) resolveUrl(match[1]!);
    });
    child.on('exit', (code) => reject(new Error(`Fake HMI exited with ${code}`)));
  });
  return {
    url,
    /** Simulate something happening at the machine (never an application API). */
    sim: (path: string) => fetch(new URL(`/__sim/${path}`, url), { method: 'POST' }),
    state: async () =>
      (await (await fetch(new URL('/__sim/state', url))).json()) as {
        recipe: string;
        machine: string;
      },
    stop: () => child.kill('SIGTERM'),
  };
}

async function hold(page: Page, name: RegExp) {
  const button = page.getByRole('button', { name });
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_100);
  await page.mouse.up();
}

test.describe('line station', () => {
  test.setTimeout(90_000);
  test('a stop observed on the screen is classified, an order is scanned and loaded, and takeover blocks the bridge', async ({
    page,
  }) => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-native-line-station-'));
    const hmi = await startHmi();
    const host = await startService('@agent-native/line-station', workspace, {
      STATION_HMI_URL: hmi.url,
      STATION_SIMULATOR: '1',
      STATION_OBSERVE_MS: '250',
    });
    try {
      await page.goto(host.launchUrl);
      await expect(page.getByRole('link', { name: 'Stations', exact: true })).toBeVisible();
      await page.goto(`${host.origin}/#/station/line-1`);
      const strip = page
        .getByRole('status')
        .filter({ hasText: /RUNNING|STOPPED|No recent/ })
        .first();
      await expect(strip).toContainText('RUNNING', { timeout: 15_000 });

      // The machine stops at the station; the bridge sees it and the surface asks why.
      await hmi.sim('stop');
      const why = page.getByRole('group', { name: /Why did the machine stop/ });
      await expect(why).toBeVisible({ timeout: 10_000 });
      await why.getByRole('button', { name: /Jam or blockage/ }).click();
      const stops = page.getByRole('region', { name: 'Recent stops' });
      await expect(stops).toContainText('JAM');
      await expect(stops.locator('[data-slot=delivery-badge][data-state=accepted]')).toBeVisible({
        timeout: 10_000,
      });

      // A supervisor lets the bridge actuate.
      await page.getByRole('link', { name: /Bridge/ }).click();
      await page.getByRole('button', { name: 'actuate' }).click();
      await expect(page.getByRole('button', { name: 'actuate' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: /Station/ }).click();

      // Scan the order, hold to start: the bridge loads the recipe on the screen and reads it back.
      await expect(page.getByText('Scan the next order')).toBeVisible();
      await wedge(page, 'ORD-7002');
      await expect(page.getByText(/Scanned: /)).toBeVisible();
      await hold(page, /Start ORD-7002/);
      const requested = page.getByRole('region', { name: 'Requested recipe' });
      await expect(requested).toContainText('R-330');
      await expect(
        requested.locator('[data-slot=delivery-badge][data-state=accepted]'),
      ).toBeVisible({ timeout: 20_000 });
      expect((await hmi.state()).recipe).toBe('R-330');
      await expect(page.getByRole('status').filter({ hasText: 'Recipe R-330' })).toBeVisible();

      // Taking over the screen is one tap; the next procedure waits until it is handed back.
      await page.getByRole('button', { name: /Take over/ }).click();
      await expect(page.getByText('Operator has the screen')).toBeVisible();
      await page.getByRole('button', { name: /ORD-7001/ }).click();
      await hold(page, /Start ORD-7001/);
      await expect(requested).toContainText('R-500');
      await page.waitForTimeout(2_500);
      expect((await hmi.state()).recipe).toBe('R-330');
      await expect(
        requested.locator('[data-slot=delivery-badge][data-state=pending]'),
      ).toBeVisible();
      await hold(page, /Hand back/);
      await expect(
        requested.locator('[data-slot=delivery-badge][data-state=accepted]'),
      ).toBeVisible({ timeout: 20_000 });
      expect((await hmi.state()).recipe).toBe('R-500');
    } finally {
      await host.stop();
      hmi.stop();
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
