import { ApplicationError } from '@tortoise/contracts';
import { AiSdkHarness } from '@tortoise/agents/ai-sdk';
import { ClaudeHarness } from '@tortoise/agents/claude';
import { CodexHarness, chatGptCodexOptions } from '@tortoise/agents/codex';
import type { Harness, HarnessTurn } from '@tortoise/agents/types';
import { providerDirectories, verifiedRuntime } from './native-runtime';
import { chooseModel, profileCredentials, turnSelection } from './profiles';
import { scopeOf, scopedVault, type ProviderState } from './state';
import { validModel } from './validation';

type HarnessId = 'codex' | 'claude' | 'ai-sdk';
type Build = (turn: HarnessTurn, key: string) => Promise<Harness>;

/** Before the provider runs: the owner's selection or explicitly loaded key must still stand. */
function recheckFunding(state: ProviderState, id: HarnessId, turn: HarnessTurn, key: string) {
  if (id === 'codex') chooseModel(state, key, turnSelection(turn.context));
  else if (!state.loadedKeys.get(key)?.has(id))
    throw new ApplicationError(
      'FORBIDDEN',
      'Provider credentials were disconnected before execution',
    );
}

/**
 * A harness whose provider is built only for a run, after scope, funding and cancellation are
 * checked. Provider errors reach the run as generic messages; credentials never do.
 */
function lazyHarness(
  state: ProviderState,
  id: HarnessId,
  features: Harness['features'],
  build: Build,
): Harness {
  return {
    id,
    features,
    async availability() {
      if (state.closed) return { available: false, reason: 'Provider access is closed' };
      return id === 'ai-sdk' || state.options.runtimeManifest
        ? { available: true }
        : { available: false, reason: 'Bundled native runtime manifest not configured' };
    },
    async *run(turn) {
      try {
        turn.signal.throwIfAborted();
        const key = scopeOf(state, turn.context);
        if (state.closed) throw new Error('Provider access closed');
        const harness = await build(turn, key);
        turn.signal.throwIfAborted();
        if (state.closed) throw new Error('Provider access closed');
        recheckFunding(state, id, turn, key);
        yield* harness.run(turn);
      } catch (error) {
        if (turn.signal.aborted) throw new ApplicationError('CANCELLED', 'Provider run cancelled');
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(
          'INTERNAL',
          'Provider execution failed; reconnect the selected account or check its configuration',
        );
      }
    },
  };
}

function codex(state: ProviderState): Build {
  const { options } = state;
  return async (turn, key) => {
    const selection = chooseModel(state, key, turnSelection(turn.context));
    const tokens = await profileCredentials(state, key, selection.profileId!);
    const executable = await verifiedRuntime(options.runtimeManifest, 'codex');
    const paths = await providerDirectories(state.workspacePath, turn, 'codex', key);
    const codexOptions = chatGptCodexOptions(tokens.accessToken, state.appName);
    return (options.factories?.codex ?? ((config) => new CodexHarness(config)))({
      executable,
      ...paths,
      model: selection.model,
      ...codexOptions,
      environment: {
        ...options.childEnvironment?.('codex-app-server'),
        ...codexOptions.environment,
      },
    });
  };
}

function claude(state: ProviderState): Build {
  const { options } = state;
  return async (turn, key) => {
    if (turn.context.providerAccount !== 'claude-api' || !state.loadedKeys.get(key)?.has('claude'))
      throw new ApplicationError('FORBIDDEN', 'Explicit Claude API key selection required');
    const apiKey = await scopedVault(state, key).get('api.claude.key');
    if (!apiKey) throw new ApplicationError('FORBIDDEN', 'Claude API key unavailable');
    return (options.factories?.claude ?? ((config) => new ClaudeHarness(config)))({
      apiKey,
      model: validModel(turn.context.model),
      executable: await verifiedRuntime(options.runtimeManifest, 'claude'),
      ...(await providerDirectories(state.workspacePath, turn, 'claude', key)),
      ...(options.childEnvironment ? { environment: options.childEnvironment('claude-code') } : {}),
    });
  };
}

function aiSdk(state: ProviderState): Build {
  return async (turn, key) => {
    if (turn.context.providerAccount !== 'ai-sdk-api' || !state.loadedKeys.get(key)?.has('ai-sdk'))
      throw new ApplicationError('FORBIDDEN', 'Explicit API-key funding selection required');
    const apiKey = await scopedVault(state, key).get('api.ai-sdk.key');
    if (!apiKey) throw new ApplicationError('FORBIDDEN', 'API key unavailable');
    const selectedModel = validModel(turn.context.model);
    if (state.options.factories?.aiSdk)
      return state.options.factories.aiSdk({ apiKey, model: selectedModel });
    const { createOpenAI } = await import('@ai-sdk/openai');
    return new AiSdkHarness({
      model: createOpenAI({
        apiKey,
        baseURL: 'https://api.openai.com/v1',
        fetch: state.fetcher,
      }).responses(selectedModel),
    });
  };
}

/** Codex on a ChatGPT plan, Claude Code and the AI SDK on explicitly saved API keys. */
export function createProviderHarnesses(state: ProviderState): Harness[] {
  return [
    lazyHarness(state, 'codex', { questions: true, approvals: false, resume: true }, codex(state)),
    lazyHarness(
      state,
      'claude',
      { questions: false, approvals: false, resume: true },
      claude(state),
    ),
    lazyHarness(
      state,
      'ai-sdk',
      { questions: true, approvals: false, resume: false },
      aiSdk(state),
    ),
  ];
}
