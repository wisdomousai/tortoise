import { File } from 'expo-file-system';
import { Linking, Platform } from 'react-native';
import type { MobileOsBindings } from '../os';

/**
 * A file the OS handed the app. On Android a `content:` URI's name is its last path segment,
 * which is often an opaque id, so handlers match such a file by the media type the provider
 * reports; on iOS an opened document is a `file:` URL with its real name.
 */
function inspect(uri: string) {
  try {
    const file = new File(uri);
    if (!file.exists) return undefined;
    return { name: file.name, size: file.size, ...(file.type ? { mediaType: file.type } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * The device's link and file calls through React Native's `Linking` and Expo's file system.
 * Links come from the launching intent or URL and each later one; a file is read once, after its
 * size is checked, and checked again after reading. Opening a URL goes through `Linking`, so the
 * OS chooses the browser or app for it.
 */
export function expoOsBindings(
  scheme: string,
  report: (message: string) => void = () => undefined,
): MobileOsBindings {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios')
    throw new Error(`The mobile shell runs on Android and iOS, not ${Platform.OS}`);
  return {
    platform: Platform.OS,
    scheme,
    initialUri: async () => (await Linking.getInitialURL()) ?? null,
    subscribe(listener) {
      const subscription = Linking.addEventListener('url', ({ url }) => listener(url));
      return () => subscription.remove();
    },
    inspect: async (uri) => inspect(uri),
    async read(uri, maxBytes) {
      try {
        const file = new File(uri);
        if (!file.exists || file.size > maxBytes) return undefined;
        const bytes = await file.bytes();
        return bytes.byteLength > maxBytes ? undefined : bytes;
      } catch {
        return undefined;
      }
    },
    open: (url) => Linking.openURL(url),
    report,
  };
}
