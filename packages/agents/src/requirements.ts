import { defineHostComponent } from '@agent-native/contracts';

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
