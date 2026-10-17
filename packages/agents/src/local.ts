import { AiSdkHarness } from './ai-sdk';
import type { Harness, HarnessEvent, HarnessTurn, ModelIdentity } from './types';

/**
 * The model a loopback server serves (llama.cpp `llama-server`, Ollama, vLLM), as the
 * deployment configured it. `model` is the ID the server lists at `/v1/models`.
 */
export interface LocalModel {
  readonly model: string;
  /** Content digest of the weights, recorded on each run; the server is not asked to prove it. */
  readonly digest?: string;
}

/**
 * A fetch bound to the `local-inference` destination: relative paths resolve against the address
 * the site policy bound, which the guard keeps on loopback. A network port `client` is one.
 */
export interface LocalModelClient {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface LocalHarnessOptions extends LocalModel {
  /** Called per request, so an unbound destination fails the call, not construction. */
  readonly client: () => LocalModelClient;
  readonly maxSteps?: number;
  readonly maxOutputTokens?: number;
}

// The AI SDK needs an absolute base URL. This placeholder never reaches the network: the
// adapter below strips it and hands the bound client a relative path.
const PLACEHOLDER = 'http://local-inference.invalid/';

function boundFetch(client: () => LocalModelClient): typeof fetch {
  const adapter = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request ? request.url : String(input));
    if (url.origin !== new URL(PLACEHOLDER).origin)
      throw new Error('Local model requests stay on the local-inference destination');
    const path = `${url.pathname.replace(/^\/+/, '')}${url.search}`;
    return client().fetch(
      path,
      request
        ? { method: request.method, headers: request.headers, body: request.body, ...init }
        : init,
    );
  };
  return adapter as typeof fetch;
}

/** Whether the server lists the configured model; any failure reads as unavailable. */
async function served(client: () => LocalModelClient, model: string) {
  try {
    const response = await client().fetch('v1/models', { headers: { accept: 'application/json' } });
    if (!response.ok) return { available: false, reason: `Local model server: ${response.status}` };
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    return body.data?.some((entry) => entry.id === model)
      ? { available: true }
      : { available: false, reason: `Local model server does not serve ${model}` };
  } catch {
    return { available: false, reason: 'Local model server unreachable or unbound' };
  }
}

/**
 * A harness over an OpenAI-compatible server on this host. It runs the AI SDK harness with the
 * chat completions model, so tool calls, budgets and cancellation behave as for a provider run,
 * but prompts and tool results go only to the `local-inference` destination. It sends a fixed
 * placeholder key and never reads `OPENAI_API_KEY` or `OPENAI_BASE_URL`.
 */
export function localHarness(options: LocalHarnessOptions): Harness {
  const model: ModelIdentity = {
    provider: 'local',
    model: options.model,
    ...(options.digest ? { digest: options.digest } : {}),
  };
  return {
    id: 'local',
    features: { questions: false, approvals: false, resume: false },
    inference: 'local',
    model,
    availability: () => served(options.client, options.model),
    async *run(turn: HarnessTurn): AsyncIterable<HarnessEvent> {
      const { createOpenAI } = await import('@ai-sdk/openai');
      const provider = createOpenAI({
        name: 'local',
        apiKey: 'local',
        baseURL: `${PLACEHOLDER}v1`,
        fetch: boundFetch(options.client),
      });
      yield* new AiSdkHarness({
        model: provider.chat(options.model),
        ...(options.maxSteps ? { maxSteps: options.maxSteps } : {}),
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
      }).run(turn);
    },
  };
}
