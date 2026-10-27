import { secureEndpoint } from '@agent-native/agents/oidc';

/** The bound destination's fetch, as the network port's client offers it. */
export type DestinationFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** The endpoints of a workforce identity provider, read from its discovery document. */
export interface ProviderMetadata {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
}

/** Bounded JSON from the identity provider; anything else is refused. */
export async function providerJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`Identity provider returned ${response.status}`);
  const text = await response.text();
  if (text.length > 128_000) throw new Error('Identity provider response exceeded limit');
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Invalid identity provider response');
  return data as Record<string, unknown>;
}

/**
 * Read `<issuer>/.well-known/openid-configuration` through `fetcher`, the network port's client
 * for the bound destination. The document must name the configured issuer exactly, and every
 * endpoint must be HTTPS on the issuer's origin, because the destination reaches only that
 * origin. The browser is sent only to `authorizationEndpoint`; the host fetches the others.
 */
export async function discover(
  issuer: string,
  fetcher: DestinationFetch,
): Promise<ProviderMetadata> {
  const base = issuer.endsWith('/') ? issuer : `${issuer}/`;
  const data = await providerJson(
    await fetcher(new URL('.well-known/openid-configuration', base), {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    }),
  );
  if (data.issuer !== issuer) throw new Error('Discovery document names another issuer');
  const origin = secureEndpoint(issuer).origin;
  const endpoint = (key: string) => {
    const value = data[key];
    if (typeof value !== 'string') throw new Error(`Discovery document has no ${key}`);
    const url = secureEndpoint(value);
    if (url.origin !== origin) throw new Error(`${key} is not on the issuer's origin`);
    return url.toString();
  };
  return {
    issuer,
    authorizationEndpoint: endpoint('authorization_endpoint'),
    tokenEndpoint: endpoint('token_endpoint'),
    jwksUri: endpoint('jwks_uri'),
  };
}
