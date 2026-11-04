import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { setIntentFilters } = require('../intent-filters.plugin.cjs') as {
  setIntentFilters(manifest: unknown, filters: unknown[]): Manifest;
};
interface Manifest {
  manifest: { application: { activity: { $: object; 'intent-filter'?: unknown[] }[] }[] };
}

const manifest = (filters: unknown[]): Manifest => ({
  manifest: {
    application: [
      {
        activity: [
          {
            $: { 'android:name': '.MainActivity' },
            'intent-filter': [
              {
                action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
                category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
              },
              ...filters,
            ],
          },
        ],
      },
    ],
  },
});

test('the config plugin writes intent filters with their declared names and DEFAULT', () => {
  const filters = [
    {
      action: 'dev.example.notes.action.ATTACH',
      categories: ['dev.example.notes.category.PRINT'],
      data: { scheme: 'content', mimeType: 'application/pdf' },
    },
    { action: 'dev.example.notes.action.CREATE', categories: [] },
  ];
  const once = setIntentFilters(manifest([]), filters);
  const written = once.manifest.application[0]!.activity[0]!['intent-filter']!;
  expect(written).toHaveLength(3);
  expect(written[1]).toEqual({
    $: { 'data-tortoise-intent': 'true' },
    action: [{ $: { 'android:name': 'dev.example.notes.action.ATTACH' } }],
    category: [
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
      { $: { 'android:name': 'dev.example.notes.category.PRINT' } },
    ],
    data: [{ $: { 'android:scheme': 'content', 'android:mimeType': 'application/pdf' } }],
  });
  // A second prebuild replaces what the first wrote and keeps the launcher filter.
  const twice = setIntentFilters(once, filters.slice(1));
  const again = twice.manifest.application[0]!.activity[0]!['intent-filter']!;
  expect(again).toHaveLength(2);
  expect(again[0]).toMatchObject({
    category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
  });
});
