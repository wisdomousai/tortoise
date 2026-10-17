// Expo config plugin, listed by `mobile:prepare` (through `nativeOsConfig`) when the application
// declares intent handlers, with `{ filters: [{ action, categories, data? }] }`. Expo's own
// `android.intentFilters` prefixes every action and category with `android.intent.action.` and
// `android.intent.category.`, so it cannot name an application's own actions; this writes the
// names as declared. Every filter also carries DEFAULT, without which no implicit
// `startActivity` reaches the activity. Filters from an earlier prebuild are replaced.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const GENERATED = 'data-agent-native-intent';

/** `manifest` with the main activity's generated intent filters replaced by `filters`. */
function setIntentFilters(manifest, filters) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const kept = (activity['intent-filter'] ?? []).filter(
    (filter) => filter.$?.[GENERATED] !== 'true',
  );
  const generated = filters.map((filter) => ({
    $: { [GENERATED]: 'true' },
    action: [{ $: { 'android:name': filter.action } }],
    category: [...new Set(['android.intent.category.DEFAULT', ...(filter.categories ?? [])])].map(
      (name) => ({ $: { 'android:name': name } }),
    ),
    ...(filter.data
      ? {
          data: [
            {
              $: Object.fromEntries(
                Object.entries(filter.data).map(([key, value]) => [`android:${key}`, value]),
              ),
            },
          ],
        }
      : {}),
  }));
  activity['intent-filter'] = [...kept, ...generated];
  return manifest;
}

module.exports = function withIntentFilters(config, options = {}) {
  return withAndroidManifest(config, (config) => {
    config.modResults = setIntentFilters(config.modResults, options.filters ?? []);
    return config;
  });
};

module.exports.setIntentFilters = setIntentFilters;
