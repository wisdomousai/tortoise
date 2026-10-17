import { linkPathSegments, type CatalogOs } from '@agent-native/contracts';

/** What the stores know the app by: the Apple team and the Android signing certificates. */
export interface AssociationIdentity {
  /** The bundle identifier and Android package, from the application identity. */
  readonly appId: string;
  /** The ten-character Apple Developer team id. */
  readonly teamId: string;
  /** SHA-256 fingerprints of the Android signing certificates, as `AA:BB:…` (32 bytes). */
  readonly sha256Certs: readonly string[];
}

const teamPattern = /^[A-Z0-9]{10}$/;
const fingerprintPattern = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;

/**
 * The two files a web host serves so the phones open its links in the app: Apple's
 * `apple-app-site-association` (at `/.well-known/`) and Android's `assetlinks.json`. Only
 * handlers that declare `verified` are listed, each path with its parameters as wildcards; the
 * matcher still checks the exact path and parameters when a link arrives. Throws on a malformed
 * team id or fingerprint, and when no handler is verified, because an empty association would
 * claim nothing.
 */
export function associationFiles(os: CatalogOs | undefined, identity: AssociationIdentity) {
  if (!teamPattern.test(identity.teamId))
    throw new Error('An Apple team id is ten letters or digits');
  if (
    !identity.sha256Certs.length ||
    identity.sha256Certs.some((cert) => !fingerprintPattern.test(cert))
  )
    throw new Error(
      'Signing certificate fingerprints are 32 colon-separated hex bytes, upper case',
    );
  const links = (os?.handlers ?? []).filter(
    (handler) => handler.kind === 'link' && handler.verified,
  ) as Extract<CatalogOs['handlers'][number], { kind: 'link' }>[];
  if (!links.length) throw new Error('No verified link handler is declared');
  const pattern = (path: string) =>
    `/${linkPathSegments(path)
      .map((segment) => ('param' in segment ? '*' : segment.literal))
      .join('/')}`;
  return {
    'apple-app-site-association': {
      applinks: {
        details: [
          {
            appIDs: [`${identity.teamId}.${identity.appId}`],
            components: links.map((link) => ({ '/': pattern(link.path), comment: link.id })),
          },
        ],
      },
    },
    'assetlinks.json': [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: identity.appId,
          sha256_cert_fingerprints: [...identity.sha256Certs],
        },
      },
    ],
  };
}
