/**
 * Records golden frames from the simulated HMI in a real browser: PNG pixels plus the
 * accessibility tree, with the values a person would confirm on each. Run after changing the
 * simulator or the profile: `bun showcase/examples/winding-line/fake-hmi/record-golden.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createPlaywrightTransport, type FieldValue } from '@agent-native/screen-bridge';
import { startFakeHmi } from './server';
import { HEIGHT, WIDTH } from './simulator';

const directory = new URL('../golden/', import.meta.url);
mkdirSync(directory, { recursive: true });
const hmi = startFakeHmi();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(hmi.url);
  const transport = createPlaywrightTransport({ page, pixels: true });
  const { sim } = hmi;
  const frames: unknown[] = [];
  async function record(name: string, screen: string | null, setup: () => void) {
    setup();
    await page.waitForTimeout(400);
    const frame = await transport.capture(new AbortController().signal);
    const { image, ...rest } = frame;
    writeFileSync(new URL(`${name}.png`, directory), image!);
    writeFileSync(
      new URL(`${name}.json`, directory),
      `${JSON.stringify({ ...rest, capturedAt: 0 }, null, 2)}\n`,
    );
    const state = sim.state;
    const expected: Record<string, FieldValue> =
      screen === 'main'
        ? {
            machine: state.machine,
            alarm: state.alarm,
            recipe: state.recipe,
            good: state.good,
            scrap: state.scrap,
          }
        : {};
    frames.push({ name, frame: `${name}.json`, image: `${name}.png`, screen, expected });
  }
  // Counters are frozen while stopped, so pixels and expectations agree.
  await record('stopped', 'main', () => {
    sim.stopMachine();
    Object.assign(sim.state, { good: 4210, scrap: 37, recipe: 'R-250' });
  });
  await record('alarm', 'main', () => {
    sim.raiseAlarm('E-214 Wire break at tensioner');
    Object.assign(sim.state, { good: 10482, scrap: 119 });
  });
  await record('recipe-dialog', 'recipe', () => {
    sim.stopMachine();
    sim.press('load');
    sim.setDraft('R-33');
  });
  await record('maintenance-popup', null, () => {
    sim.press('cancel');
    sim.showPopup();
  });
  await record('large-counts', 'main', () => {
    sim.press('popupOk');
    Object.assign(sim.state, { good: 98765, scrap: 1204, recipe: 'R-100' });
  });
  writeFileSync(
    new URL('manifest.json', directory),
    `${JSON.stringify({ profile: '../station-profile.json', frames }, null, 2)}\n`,
  );
  console.log(`Recorded ${frames.length} golden frames in ${directory.pathname}`);
} finally {
  await browser.close();
  hmi.stop();
}
