import { z } from 'zod';
import { defineHostComponent, jsonSchema } from '@agent-native/contracts';

/** 32 random bytes in base64url, as the authorization request makes them. */
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * The ChatGPT authorization request as the account screen links it. The desktop opens a URL in
 * the system browser only when a declared open action builds it, so this schema is the whole
 * rule: the authorization endpoint, a loopback callback, the authorization-code flow and S256.
 */
const authorizeParams = z.strictObject({
  client_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/),
  ext_agent_host_id: z.string().regex(/^urn:uuid:[A-Fa-f0-9-]{36}$/),
  response_type: z.literal('code'),
  redirect_uri: z
    .string()
    .regex(/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[0-9]{1,5}\/oauth\/chatgpt\/callback$/),
  scope: z.string().regex(/^[a-z_.:]+(?: [a-z_.:]+){0,15}$/),
  resource: z.literal('https://api.openai.com/v1'),
  state: secret,
  nonce: secret,
  code_challenge_method: z.literal('S256'),
  code_challenge: secret,
  agent_name_hint: z.string().max(200).optional(),
  login_hint: z.string().max(320).optional(),
});

/**
 * Network and process requirements of the provider harnesses, as data. Importing this file loads
 * no SDK. Every destination is optional and `unavailable` offline: without a site-policy binding
 * the deterministic harness and loopback models keep working and provider runs report why not.
 */
export const openAiComponent = defineHostComponent({
  id: 'openai',
  description: 'ChatGPT plan sign-in, model catalog, Codex app-server and AI SDK inference.',
  requirements: {
    network: [
      {
        id: 'openai-auth',
        purpose: 'ChatGPT sign-in: token exchange, OIDC discovery, signing keys and revocation.',
        direction: 'egress',
        scope: 'internet',
        protocol: 'https',
        host: 'auth.openai.com',
        dataClasses: ['oauth-authorization', 'identity-token'],
        availability: 'optional',
        offline: 'unavailable',
      },
      {
        id: 'openai-api',
        purpose: 'Model catalog and inference for Codex and AI SDK runs.',
        direction: 'egress',
        scope: 'internet',
        protocol: 'https',
        host: 'api.openai.com',
        dataClasses: ['prompt', 'application-context', 'tool-results'],
        availability: 'optional',
        offline: 'unavailable',
      },
    ],
    processes: [
      {
        id: 'codex-app-server',
        executable: 'codex',
        purpose: 'Codex app-server harness under a delegated grant.',
        availability: 'optional',
        network: ['openai-api'],
      },
    ],
  },
  os: {
    actions: [
      {
        id: 'openai.authorize',
        kind: 'open',
        description: 'Open ChatGPT sign-in in the system browser.',
        url: 'https://auth.openai.com/api/accounts/authorize',
        params: jsonSchema(authorizeParams),
        dataClasses: ['oauth-authorization'],
      },
    ],
  },
});

export const anthropicComponent = defineHostComponent({
  id: 'anthropic',
  description: 'Claude Agent SDK harness with API-key funding.',
  requirements: {
    network: [
      {
        id: 'anthropic-api',
        purpose: 'Inference for Claude runs.',
        direction: 'egress',
        scope: 'internet',
        protocol: 'https',
        host: 'api.anthropic.com',
        dataClasses: ['prompt', 'application-context', 'tool-results'],
        availability: 'optional',
        offline: 'unavailable',
      },
    ],
    processes: [
      {
        id: 'claude-code',
        executable: 'claude',
        purpose: 'Claude Code process driven by the Agent SDK.',
        availability: 'optional',
        network: ['anthropic-api'],
      },
    ],
  },
});

export const providerComponents = [openAiComponent, anthropicComponent] as const;
