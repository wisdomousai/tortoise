import type { Effect } from '@agent-native/runtime';
import type { LookupResult } from '@agent-native/integration';
import { accepted, confirm, observe, type ControllerKernel } from './kernel';

/**
 * Readback of an earlier delivery. Converged: accepted. Never attempted, or attempted by this
 * process without touching the screen: deliver. Rerunnable, or back on the start screen: deliver
 * again (the earlier attempt did not stick). Anything else: uncertain, so the dispatcher holds
 * it for a person.
 */
export async function lookup(
  kernel: ControllerKernel,
  signal: AbortSignal,
  effect?: Readonly<Effect>,
): Promise<LookupResult> {
  const procedure = effect && kernel.procedures.get(effect.type);
  if (!effect || !procedure) return undefined;
  const readback = await confirm(
    kernel,
    procedure.readback,
    effect.payload,
    await observe(kernel, signal),
    signal,
  );
  if (readback.met) return accepted(readback.view);
  const view = readback.view;
  const untouched = kernel.attempted.has(effect.id) && !kernel.touched.has(effect.id);
  if (
    effect.attempts === 0 ||
    untouched ||
    view.screen === procedure.startScreen ||
    procedure.rerunnable
  )
    return undefined;
  return {
    status: 'uncertain',
    reason: `Station shows ${view.screen ?? 'an unknown screen'} after an interrupted ${procedure.title}`,
  };
}
