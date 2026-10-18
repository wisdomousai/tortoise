import type { Effect } from '@agent-native/runtime';
import { lookupConvergent, type LookupResult } from '@agent-native/integration';
import { accepted, confirm, observe, type ControllerKernel } from './kernel';

/**
 * Readback of an earlier delivery, by the convergent rule (see `lookupConvergent`): the screen
 * shows the result, or this process never touched it, or it is back on the start screen.
 */
export async function lookup(
  kernel: ControllerKernel,
  signal: AbortSignal,
  effect?: Readonly<Effect>,
): Promise<LookupResult> {
  const procedure = effect && kernel.procedures.get(effect.type);
  if (!effect || !procedure) return undefined;
  return lookupConvergent(
    {
      effect,
      rerunnable: procedure.rerunnable ?? false,
      untouched: kernel.attempts.untouched(effect.id),
      readback: async (inner) =>
        confirm(kernel, procedure.readback, effect.payload, await observe(kernel, inner), inner),
      accepted,
      atStart: (view) => view.screen === procedure.startScreen,
      uncertain: (view) =>
        `Station shows ${view.screen ?? 'an unknown screen'} after an interrupted ${procedure.title}`,
    },
    signal,
  );
}
