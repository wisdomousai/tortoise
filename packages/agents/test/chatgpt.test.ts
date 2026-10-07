import { beforeAll, describe, expect, test } from 'bun:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { ChatGptAccountConnection } from '../src/chatgpt';
import { MemoryCredentialVault } from '../src/credentials';
import { chatGptCodexOptions } from '../src/codex';
let privateKey: CryptoKey;
let keyResolver: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  keyResolver = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'fixture', alg: 'RS256', use: 'sig' }],
  });
});
function fixture() {
  const vault = new MemoryCredentialVault();
  const requests: URLSearchParams[] = [];
  let nonce = '';
  let subject = 'account-1';
  let granted = 'openid profile resource.invoke chatgpt.tokens.use.direct';
  const fetcher = (async (input: string | URL | Request, options?: RequestInit) => {
    if (String(input).endsWith('openid-configuration'))
      return Response.json({
        issuer: 'https://auth.openai.com',
        revocation_endpoint: 'https://auth.openai.com/revoke',
      });
    if (String(input).endsWith('/revoke')) return new Response(null, { status: 200 });
    const body = new URLSearchParams(options!.body as URLSearchParams);
    requests.push(body);
    const id = await new SignJWT({ nonce, email: 'test@example.invalid' })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setIssuer('https://auth.openai.com')
      .setAudience(body.get('client_id')!)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    return Response.json({
      access_token: `access-${requests.length}`,
      id_token: id,
      refresh_token: `refresh-${requests.length}`,
      token_type: 'Bearer',
      expires_in: 300,
      scope: granted,
    });
  }) as typeof fetch;
  const connection = new ChatGptAccountConnection({
    vault,
    appName: 'Test application',
    redirectUri: 'http://127.0.0.1:12345/auth/callback',
    keyResolver,
    fetch: fetcher,
  });
  return {
    connection,
    requests,
    vault,
    setSubject(value: string) {
      subject = value;
    },
    setGranted(value: string) {
      granted = value;
    },
    async begin(profile?: string) {
      const result = await connection.begin('local-session', profile);
      const url = new URL(result.authorizationUrl);
      nonce = url.searchParams.get('nonce')!;
      return {
        url,
        callback: `http://127.0.0.1:12345/auth/callback?state=${url.searchParams.get('state')}&code=fixture&client_id=oaiapp_fixture`,
      };
    },
  };
}
describe('ChatGPT dynamic public-client enrollment without live calls', () => {
  test('PKCE, issued client ID, resource, verified account and persistent host identity', async () => {
    const f = fixture();
    const first = await f.begin();
    expect(first.url.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(first.url.searchParams.get('agent_name_hint')).toBe('Test application');
    expect(first.url.searchParams.get('code_challenge_method')).toBe('S256');
    const profile = await f.connection.complete(first.callback, 'local-session');
    expect(profile.planUsageEnabled).toBe(true);
    expect(profile.subject).toBe('account-1');
    expect(f.requests[0]!.get('client_id')).toBe('oaiapp_fixture');
    expect(f.requests[0]!.get('resource')).toBe('https://api.openai.com/v1');
    const verifier = f.requests[0]!.get('code_verifier')!;
    expect(new Bun.CryptoHasher('sha256').update(verifier).digest('base64url')).toBe(
      first.url.searchParams.get('code_challenge')!,
    );
    expect(JSON.stringify(profile)).not.toContain('access-1');
    expect(JSON.stringify(profile)).not.toContain('id_token');
    const second = await f.begin(profile.id);
    expect(second.url.searchParams.has('id_token_hint')).toBe(false);
    expect(second.url.toString()).not.toContain('access-1');
    expect(second.url.searchParams.get('client_id')).toBe('oaiapp_fixture');
    expect(second.url.searchParams.has('agent_name_hint')).toBe(false);
    expect(second.url.searchParams.get('ext_agent_host_id')).toBe(
      first.url.searchParams.get('ext_agent_host_id'),
    );
    await expect(f.connection.complete(first.callback, 'local-session')).rejects.toThrow('state');
  });
  test('wrong local session cannot consume a valid attempt; wrong account cannot replace saved profile', async () => {
    const f = fixture();
    const first = await f.begin();
    await expect(f.connection.complete(first.callback, 'other-session')).rejects.toThrow('state');
    const profile = await f.connection.complete(first.callback, 'local-session');
    const second = await f.begin(profile.id);
    f.setSubject('another-account');
    await expect(f.connection.complete(second.callback, 'local-session')).rejects.toThrow(
      'does not match',
    );
    expect((await f.connection.profiles())[0]!.subject).toBe('account-1');
  });
  test('decline, missing issued client and ambiguous callbacks fail before exchange', async () => {
    for (const suffix of ['&error=access_denied', '&client_id=another', '']) {
      const f = fixture();
      const first = await f.begin();
      const callback = suffix
        ? first.callback + suffix
        : first.callback.replace('&client_id=oaiapp_fixture', '');
      await expect(f.connection.complete(callback, 'local-session')).rejects.toThrow();
      expect(f.requests.length).toBe(0);
    }
  });
  test('requested scope is insufficient; valid identity with no plan grant is disabled', async () => {
    const f = fixture();
    f.setGranted('openid profile');
    const first = await f.begin();
    const profile = await f.connection.complete(first.callback, 'local-session');
    expect(profile.planUsageEnabled).toBe(false);
    await expect(f.connection.credentials(profile.id)).rejects.toThrow('not enabled');
  });
  test('rotating refresh is serialized and logout clears token hints while retaining registration', async () => {
    const f = fixture();
    const first = await f.begin();
    const profile = await f.connection.complete(first.callback, 'local-session');
    await Promise.all([f.connection.refresh(profile.id), f.connection.refresh(profile.id)]);
    expect(f.requests[1]!.get('refresh_token')).toBe('refresh-1');
    expect(f.requests[2]!.get('refresh_token')).toBe('refresh-2');
    expect(f.requests[1]!.has('scope')).toBe(false);
    expect((await f.connection.credentials(profile.id)).accessToken).toBe('access-3');
    expect(await f.connection.logout(profile.id)).toEqual({ revocationConfirmed: true });
    await expect(f.connection.credentials(profile.id)).rejects.toThrow('not enabled');
    const returning = await f.begin(profile.id);
    expect(returning.url.searchParams.get('client_id')).toBe('oaiapp_fixture');
    expect(returning.url.searchParams.has('id_token_hint')).toBe(false);
  });
  test('Codex plan options pass tokens only through explicitly injected child env', () => {
    const options = chatGptCodexOptions('fixture-token', 'Test application');
    expect(options.environment).toEqual({ ACCESS_TOKEN: 'fixture-token' });
    expect(options.startupConfig!['model_providers.openai_chatgpt_plan.env_key']).toBe(
      'ACCESS_TOKEN',
    );
    expect(JSON.stringify(options.startupConfig)).not.toContain('fixture-token');
  });
});

test('OIDC nonce, signature, audience, issuer and expiry are validated server side', async () => {
  const { verifyOidcIdentity } = await import('../src/oidc');
  const sign = (
    values: { issuer?: string; audience?: string; nonce?: string; expired?: boolean } = {},
  ) =>
    new SignJWT({ nonce: values.nonce ?? 'expected-nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
      .setSubject('subject')
      .setIssuer(values.issuer ?? 'https://auth.openai.com')
      .setAudience(values.audience ?? 'issued-client')
      .setIssuedAt()
      .setExpirationTime(values.expired ? '0s' : '5m')
      .sign(privateKey);
  for (const values of [
    { issuer: 'https://wrong.invalid' },
    { audience: 'wrong-client' },
    { nonce: 'wrong-nonce' },
    { expired: true },
  ])
    await expect(
      verifyOidcIdentity(
        await sign(values),
        keyResolver,
        'https://auth.openai.com',
        'issued-client',
        'expected-nonce',
        Date.now(),
      ),
    ).rejects.toThrow();
  const signed = await sign();
  const parts = signed.split('.');
  parts[2] = Buffer.alloc(256).toString('base64url');
  await expect(
    verifyOidcIdentity(
      parts.join('.'),
      keyResolver,
      'https://auth.openai.com',
      'issued-client',
      'expected-nonce',
      Date.now(),
    ),
  ).rejects.toThrow();
});
test('locked credential store aborts connection without a plaintext fallback', async () => {
  const unavailable = new ChatGptAccountConnection({
    appName: 'Test application',
    redirectUri: 'http://127.0.0.1:12345/auth/callback',
    vault: {
      get: async () => {
        throw new Error('OS credential store locked');
      },
      set: async () => {
        throw new Error('unexpected');
      },
      remove: async () => false,
    },
    keyResolver,
    fetch: Object.assign(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
        throw new Error('unexpected network');
      },
      { preconnect: fetch.preconnect },
    ),
  });
  await expect(unavailable.begin('session')).rejects.toThrow('store locked');
});
test('a missing resource.invoke grant disables plan execution even with direct-token scope', async () => {
  const f = fixture();
  f.setGranted('openid chatgpt.tokens.use.direct');
  const first = await f.begin();
  expect((await f.connection.complete(first.callback, 'local-session')).planUsageEnabled).toBe(
    false,
  );
});
