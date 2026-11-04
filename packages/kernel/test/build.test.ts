import { expect, test } from 'bun:test';
import { defineModule } from '@tortoise/contracts';
import { defineApplication } from '../src/application';
import {
  bestBeforeDate,
  buildFacts,
  pastBestBefore,
  stampBuild,
  type BuildFacts,
} from '../src/build';
import { openInstance } from '../src/instance';
import { defineManifest } from '../src/manifest';
import { defineHostPlugin } from '../src/plugin';
import { definePluginManifest } from '../src/plugin-manifest';
import { fakePlatform } from './fake-platform';

const DAY = 86_400_000;

test('the best-before date is the UTC build date plus the shelf life, and passes the day after', () => {
  expect(bestBeforeDate('2026-10-27T15:00:00.000Z', 180)).toBe('2027-04-25');
  expect(bestBeforeDate('2026-12-31T23:59:59.000Z', 1)).toBe('2027-01-01');
  expect(() => bestBeforeDate('yesterday', 30)).toThrow('Invalid build time');
  const lastDay = Date.UTC(2027, 3, 25);
  expect(pastBestBefore('2027-04-25', lastDay + DAY - 1)).toBe(false);
  expect(pastBestBefore('2027-04-25', lastDay + DAY)).toBe(true);
});

test('build facts come only from a stamped definition, and the date only with a shelf life', () => {
  const stamp = { builtAt: '2026-10-27T00:00:00.000Z' };
  expect(buildFacts({}, undefined)).toBeUndefined();
  expect(buildFacts({ shelfLifeDays: 30 }, undefined)).toBeUndefined();
  expect(buildFacts({}, stamp)).toEqual(stamp);
  expect(buildFacts({ shelfLifeDays: 30 }, stamp)).toEqual({
    ...stamp,
    shelfLifeDays: 30,
    bestBefore: '2026-11-26',
  });
});

test('a shelf life is a positive whole number of days', () => {
  const manifest = (shelfLifeDays: number) =>
    defineManifest({ id: 'shelf', title: 'Shelf', modules: [], shelfLifeDays });
  expect(manifest(1).shelfLifeDays).toBe(1);
  for (const invalid of [0, -1, 1.5, Number.NaN])
    expect(() => manifest(invalid)).toThrow('positive whole number of days');
});

test('a stamped definition opens its plugins with the build facts', async () => {
  const seen: (BuildFacts | undefined)[] = [];
  const watcher = defineHostPlugin({
    manifest: definePluginManifest({ id: 'watcher', title: 'Watcher', platforms: ['android'] }),
    async open(context) {
      seen.push(context.build);
      return {};
    },
  });
  const definition = defineApplication<Record<string, never>>({
    manifest: defineManifest({
      id: 'shelf',
      title: 'Shelf',
      modules: [defineModule({ id: 'shelf', capabilities: [] })],
      plugins: [watcher.manifest],
      shelfLifeDays: 30,
    }),
    createState: () => ({}),
    handlers: [],
    authorization: { authorize: () => ({ allowed: true }), canReadEvent: () => true },
    plugins: [watcher],
  });
  expect(() => stampBuild(definition, 'not a date')).toThrow('Invalid build time');
  for (const candidate of [definition, stampBuild(definition, '2026-10-27T00:00:00.000Z')]) {
    const fake = fakePlatform();
    const ownership = await fake.platform.acquireOwnership('/workspace');
    const instance = await openInstance(candidate, {
      platform: fake.platform,
      ownership,
      component: 'embedded',
      serving: false,
    });
    await instance.close();
    await ownership.release();
  }
  expect(seen).toEqual([
    undefined,
    { builtAt: '2026-10-27T00:00:00.000Z', shelfLifeDays: 30, bestBefore: '2026-11-26' },
  ]);
});
