import { linkPathSegments, type CatalogOs, type CatalogOsHandler } from '@agent-native/contracts';

/**
 * Platform registrations generated from the catalog's OS handlers. Pure functions over
 * declarations and the application identity, so each output is drift-checked and nothing
 * registers itself at runtime. Verified link hosts are deployment facts: content never names
 * them, and without them no verified registration is produced.
 */

export interface OsIdentity {
  readonly appId: string;
  readonly scheme: string;
  readonly displayName?: string;
}
export interface OsRegistrationOptions {
  /** Hosts that serve this application's association files, for verified links. */
  readonly linkHosts?: readonly string[];
}
type Of<K extends CatalogOsHandler['kind']> = Extract<CatalogOsHandler, { kind: K }>;
const of = <K extends CatalogOsHandler['kind']>(os: CatalogOs | undefined, kind: K) =>
  (os?.handlers ?? []).filter((handler): handler is Of<K> => handler.kind === kind);

/** The browser form of the scheme: `web+` and lower-case letters, as `registerProtocolHandler` requires. */
export function webScheme(scheme: string): string {
  return `web+${scheme.replace(/[^a-z]/g, '')}`;
}

/**
 * An Android `pathPattern` for a link path. The pattern language has only `.` and `*`, so a
 * parameter becomes `.*` and may span segments, and a literal `.` matches any character; the
 * matcher still checks the exact path.
 */
function androidPathPattern(path: string): string {
  const segments = linkPathSegments(path);
  return `/${segments.map((segment) => ('param' in segment ? '.*' : segment.literal)).join('/')}`;
}

export interface ExpoIntentFilter {
  readonly action: string;
  readonly autoVerify?: boolean;
  readonly category?: readonly string[];
  readonly data?: readonly Readonly<Record<string, string>>[];
}

function androidIntentFilters(
  os: CatalogOs | undefined,
  options: OsRegistrationOptions,
): ExpoIntentFilter[] {
  const filters: ExpoIntentFilter[] = [];
  const hosts = options.linkHosts ?? [];
  for (const link of of(os, 'link'))
    if (link.verified && hosts.length)
      filters.push({
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: hosts.map((host) => ({
          scheme: 'https',
          host,
          pathPattern: androidPathPattern(link.path),
        })),
      });
  for (const file of of(os, 'file'))
    filters.push({
      action: 'VIEW',
      category: ['DEFAULT'],
      data: [...new Set(file.types.flatMap((type) => type.mediaTypes))].map((mimeType) => ({
        mimeType,
      })),
    });
  for (const share of of(os, 'share')) {
    const mediaTypes = [
      ...(share.accepts.text || share.accepts.url ? ['text/plain'] : []),
      ...(share.accepts.mediaTypes ?? []),
    ];
    filters.push({
      action: 'SEND',
      category: ['DEFAULT'],
      data: [...new Set(mediaTypes)].map((mimeType) => ({ mimeType })),
    });
  }
  for (const intent of of(os, 'intent'))
    filters.push({
      action: intent.action,
      category: intent.categories?.length ? intent.categories : ['DEFAULT'],
      ...(intent.data
        ? {
            data: [
              Object.fromEntries(
                Object.entries(intent.data).filter(([, value]) => value !== undefined),
              ) as Record<string, string>,
            ],
          }
        : {}),
    });
  return filters;
}

/** The type identifier for a file type: declared, the plain-text system type, or one under the app id. */
function uti(type: Of<'file'>['types'][number], appId: string): string {
  if (type.uti) return type.uti;
  if (type.mediaTypes.includes('text/plain')) return 'public.plain-text';
  return `${appId}.${type.extensions[0]}`;
}

function iosDocumentTypes(os: CatalogOs | undefined, appId: string) {
  const files = of(os, 'file');
  if (!files.length) return {};
  const types = files.flatMap((file) =>
    file.types.map((type) => ({ file, type, id: uti(type, appId) })),
  );
  const imported = types.filter(({ id }) => !id.startsWith('public.'));
  return {
    CFBundleDocumentTypes: types.map(({ file, type, id }) => ({
      CFBundleTypeName: type.description,
      CFBundleTypeRole: file.role === 'editor' ? 'Editor' : 'Viewer',
      LSHandlerRank: 'Alternate',
      LSItemContentTypes: [id],
    })),
    ...(imported.length
      ? {
          UTImportedTypeDeclarations: imported.map(({ type, id }) => ({
            UTTypeIdentifier: id,
            UTTypeDescription: type.description,
            UTTypeConformsTo: ['public.data'],
            UTTypeTagSpecification: {
              'public.filename-extension': [...type.extensions],
              'public.mime-type': [...type.mediaTypes],
            },
          })),
        }
      : {}),
  };
}

/**
 * Expo app configuration for the OS handlers: the scheme, Android intent filters for verified
 * links, opened files, shares and custom intents, iOS associated domains and document types.
 * `mobile:prepare` writes it into `apps/mobile/generated/native.json`.
 */
export function nativeOsConfig(
  os: CatalogOs | undefined,
  identity: OsIdentity,
  options: OsRegistrationOptions = {},
) {
  const verified = of(os, 'link').some((link) => link.verified);
  return {
    scheme: identity.scheme,
    android: { intentFilters: androidIntentFilters(os, options) },
    ios: {
      associatedDomains: verified
        ? (options.linkHosts ?? []).map((host) => `applinks:${host}`)
        : [],
      infoPlist: iosDocumentTypes(os, identity.appId) as Record<string, unknown>,
    },
    plugins: [] as string[],
  };
}

/**
 * electron-builder configuration for the OS handlers: the URL scheme and file associations,
 * which become `CFBundleURLTypes` and `CFBundleDocumentTypes` on macOS, registry keys from the
 * NSIS installer on Windows and `MimeType` entries in the Linux desktop file.
 */
export function desktopOsConfig(os: CatalogOs | undefined, identity: OsIdentity) {
  return {
    protocols: [{ name: identity.displayName ?? identity.appId, schemes: [identity.scheme] }],
    fileAssociations: of(os, 'file').flatMap((file) =>
      file.types.map((type) => ({
        ext: [...type.extensions],
        name: type.description,
        description: type.description,
        ...(type.mediaTypes[0] ? { mimeType: type.mediaTypes[0] } : {}),
        role: file.role === 'editor' ? 'Editor' : 'Viewer',
      })),
    ),
  };
}

/**
 * Web app manifest members for the OS handlers, in Chromium's format: the `web+` protocol
 * handler (landing at `/?os=<url>`), file handlers (the launch queue) and shortcuts. A browser
 * offers them only after the person installs the application.
 */
export function webManifestOs(os: CatalogOs | undefined, identity: OsIdentity) {
  const files = of(os, 'file');
  const shortcuts = of(os, 'shortcut');
  return {
    ...(of(os, 'link').length
      ? { protocol_handlers: [{ protocol: webScheme(identity.scheme), url: '/?os=%s' }] }
      : {}),
    ...(files.length
      ? {
          file_handlers: files.map((file) => ({
            action: '/',
            accept: Object.fromEntries(
              file.types.flatMap((type) =>
                type.mediaTypes.map((mediaType) => [
                  mediaType,
                  type.extensions.map((extension) => `.${extension}`),
                ]),
              ),
            ),
          })),
        }
      : {}),
    ...(shortcuts.length
      ? {
          shortcuts: shortcuts.map((shortcut) => ({
            name: shortcut.title,
            url: `/?os-shortcut=${encodeURIComponent(shortcut.id)}`,
          })),
        }
      : {}),
  };
}
