import { File } from 'expo-file-system';
import { clearSharedPayloads, getSharedPayloads } from 'expo-sharing';
import { Linking, Platform, Share } from 'react-native';
import type { MobileShare } from '@agent-native/shell/mobile';
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
 * What another app shared, when `uri` is the link `expo-sharing` opens the app with
 * (`<scheme>://expo-sharing`). The raw payloads are taken once and cleared; they are never
 * resolved, because resolving a shared web page fetches it. Experimental in `expo-sharing`.
 */
async function shared(uri: string, scheme: string): Promise<readonly MobileShare[] | undefined> {
  if (!uri.toLowerCase().startsWith(`${scheme.toLowerCase()}://expo-sharing`)) return undefined;
  const payloads = getSharedPayloads();
  clearSharedPayloads();
  return payloads.map((payload): MobileShare => {
    if (payload.shareType === 'text') return { kind: 'text', text: payload.value };
    if (payload.shareType === 'url') return { kind: 'url', url: payload.value };
    return {
      kind: 'file',
      uri: payload.value,
      ...(payload.mimeType ? { mediaType: payload.mimeType } : {}),
    };
  });
}

/**
 * The device's link, file and share calls through React Native's `Linking` and `Share`, Expo's
 * file system and `expo-sharing`.
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
    shared: (uri) => shared(uri, scheme),
    async share({ text, url, title }) {
      // Android's share sheet has no URL field, so a URL travels in the message there.
      const message = Platform.OS === 'ios' ? text : [text, url].filter(Boolean).join('\n');
      await Share.share({
        ...(message ? { message } : {}),
        ...(Platform.OS === 'ios' && url ? { url } : {}),
        ...(title ? { title } : {}),
      } as Parameters<typeof Share.share>[0]);
    },
    report,
  };
}
