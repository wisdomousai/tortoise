import type { CatalogOs } from '@agent-native/contracts';
import { of, shareAccepts } from './declared';
import { launcherShortcuts } from './shortcuts';

type ExpoPlugin = [string, Record<string, unknown>];

/**
 * The framework's intent filter config plugin for the intent handlers, which writes their
 * actions and categories with the names declared. Expo's `android.intentFilters` cannot carry
 * them: it prefixes every name with `android.intent.action.` or `android.intent.category.`.
 */
function intentFiltersPlugin(os: CatalogOs | undefined): ExpoPlugin | undefined {
  const intents = of(os, 'intent');
  if (!intents.length) return undefined;
  return [
    '@agent-native/mobile/intent-filters',
    {
      filters: intents.map((intent) => ({
        action: intent.action,
        categories: intent.categories ?? [],
        ...(intent.data
          ? {
              data: Object.fromEntries(
                Object.entries(intent.data).filter(([, value]) => value !== undefined),
              ),
            }
          : {}),
      })),
    },
  ];
}

/**
 * The `expo-sharing` config plugin for the share handlers: an Android SEND intent filter on the
 * main activity for text and the accepted media types, and an iOS share extension whose
 * activation rule accepts the same. Receiving shares through `expo-sharing` is experimental.
 */
function sharePlugin(os: CatalogOs | undefined): ExpoPlugin | undefined {
  const accepts = shareAccepts(os);
  if (!accepts.any) return undefined;
  const images = accepts.mediaTypes.filter((type) => type.startsWith('image/'));
  const files = accepts.mediaTypes.filter((type) => !type.startsWith('image/'));
  return [
    'expo-sharing',
    {
      android: {
        enabled: true,
        singleShareMimeTypes: [
          ...(accepts.text || accepts.url ? ['text/plain'] : []),
          ...accepts.mediaTypes,
        ],
      },
      ios: {
        enabled: true,
        activationRule: {
          supportsText: accepts.text,
          supportsWebUrlWithMaxCount: accepts.url ? 1 : 0,
          supportsImageWithMaxCount: images.length ? 1 : 0,
          supportsFileWithMaxCount: files.length ? 1 : 0,
        },
      },
    },
  ];
}

/** The `expo-notifications` config plugin when a notify action is declared; local only, no push. */
function notificationsPlugin(os: CatalogOs | undefined): ExpoPlugin | undefined {
  return os?.actions.some((action) => action.kind === 'notify')
    ? ['expo-notifications', {}]
    : undefined;
}

/**
 * The framework's shortcut config plugin for the shortcut handlers: static Android app
 * shortcuts that open each shortcut link.
 */
function shortcutsPlugin(os: CatalogOs | undefined, scheme: string): ExpoPlugin | undefined {
  const shortcuts = launcherShortcuts(os, scheme);
  return shortcuts.length ? ['@agent-native/mobile/shortcuts', { shortcuts }] : undefined;
}

/**
 * The Expo config plugins the OS handlers and actions need at prebuild: `expo-sharing` for
 * shares, `expo-notifications` for notifications, and the framework's own for intent filters
 * and Android app shortcuts.
 */
export function expoOsPlugins(os: CatalogOs | undefined, scheme: string): ExpoPlugin[] {
  return [
    sharePlugin(os),
    notificationsPlugin(os),
    intentFiltersPlugin(os),
    shortcutsPlugin(os, scheme),
  ].filter((plugin) => plugin !== undefined);
}
