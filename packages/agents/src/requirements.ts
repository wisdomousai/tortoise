import { defineHostComponent } from '@agent-native/contracts';

/**
 * Network and process requirements of the provider harnesses, as data. Importing this file loads
 * no SDK. Every destination is optional and `unavailable` offline: without a site-policy binding
 * the deterministic harness keeps working and model runs report why not. The local model's
 * destination is loopback-scoped, so the guard refuses any binding that leaves this host.
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

/** The destination a local model server is bound to; the site policy supplies its address. */
export const LOCAL_INFERENCE_DESTINATION = 'local-inference';

export const localInferenceComponent = defineHostComponent({
  id: 'local-inference',
  description: 'OpenAI-compatible model server on this host (llama.cpp, Ollama, vLLM).',
  requirements: {
    network: [
      {
        id: LOCAL_INFERENCE_DESTINATION,
        purpose: 'Inference for agents that require a local model. Prompts stay on this host.',
        direction: 'egress',
        scope: 'loopback',
        protocol: 'http',
        dataClasses: ['prompt', 'application-context', 'tool-results'],
        availability: 'optional',
        offline: 'unavailable',
      },
    ],
  },
});

export const providerComponents = [
  openAiComponent,
  anthropicComponent,
  localInferenceComponent,
] as const;
