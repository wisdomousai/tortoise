import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const plugin = require('../shortcuts.plugin.cjs') as {
  shortcutsXml(shortcuts: unknown[], packageName: string, targetClass: string): string;
  setShortcutsMetaData(manifest: Manifest): Manifest;
  resourceText(text: string): string;
};
interface Manifest {
  manifest: { application: { activity: { $: object; 'meta-data'?: unknown[] }[] }[] };
}

test('static shortcuts open their link in the main activity', () => {
  const xml = plugin.shortcutsXml(
    [{ id: 'note.new', title: 'New note', link: 'dev.example.notes:///?os-shortcut=note.new' }],
    'dev.example.notes',
    'dev.example.notes.MainActivity',
  );
  expect(xml).toContain(
    '<shortcut android:shortcutId="note.new" android:enabled="true" android:shortcutShortLabel="@string/os_shortcut_0">',
  );
  expect(xml).toContain(
    '<intent android:action="android.intent.action.VIEW" android:targetPackage="dev.example.notes" ' +
      'android:targetClass="dev.example.notes.MainActivity" ' +
      'android:data="dev.example.notes:///?os-shortcut=note.new" />',
  );
  // An id or link cannot close the attribute it sits in.
  expect(plugin.shortcutsXml([{ id: 'a"b', title: '', link: '<x>&' }], 'p.q', 'p.q.A')).toContain(
    'android:shortcutId="a&quot;b"',
  );
});

test('titles are literal string resources, and the activity points at the shortcuts once', () => {
  expect(plugin.resourceText("Today's @note")).toBe("Today\\'s @note");
  expect(plugin.resourceText('@string/other')).toBe('\\@string/other');
  const manifest: Manifest = {
    manifest: { application: [{ activity: [{ $: { 'android:name': '.MainActivity' } }] }] },
  };
  const twice = plugin.setShortcutsMetaData(plugin.setShortcutsMetaData(manifest));
  expect(twice.manifest.application[0]!.activity[0]!['meta-data']).toEqual([
    { $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/os_shortcuts' } },
  ]);
});
