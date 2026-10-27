import type { Effect, EffectOutcome } from '@agent-native/runtime';
import { DeliveryFailure, deliverConvergent } from '@agent-native/integration';
import { resolveBinding, type Procedure } from '../profile';
import { accepted, confirm, observe, rejected, type ControllerKernel } from './kernel';
import { runProcedure } from './procedure';
import { blockedBy } from './safety';

/** A payload problem that rejects the effect before anything is read or done. */
function payloadProblem(procedure: Procedure, input: unknown): EffectOutcome | undefined {
  if (
    procedure.risk === 'operator-present' &&
    !resolveBinding('$input.presence.confirmedBy', input)
  )
    return rejected('PRECONDITION', `${procedure.title} needs confirmation at the station`);
  // Every binding resolves before the first action, so a bad payload never half-runs.
  for (const step of procedure.steps)
    if (step.kind === 'type' && resolveBinding(step.text, input) === undefined)
      return rejected('INVALID_PAYLOAD', `${procedure.title} is missing ${String(step.text)}`);
  return undefined;
}

/**
 * Deliver one effect: gate on the bridge state, accept on convergence, require the start screen
 * and stable preconditions, then run the procedure. See `createStationConnector` for the order.
 */
export async function deliver(
  kernel: ControllerKernel,
  effect: Readonly<Effect>,
  signal: AbortSignal,
): Promise<EffectOutcome> {
  const procedure = kernel.procedures.get(effect.type);
  if (!procedure) return rejected('UNSUPPORTED', `No station procedure for ${effect.type}`);
  const input = effect.payload;
  const problem = payloadProblem(procedure, input);
  if (problem) return problem;

  kernel.attempts.attempt(effect.id);
  const blocked = blockedBy(await kernel.options.control(signal), procedure);
  if (blocked) throw new DeliveryFailure(blocked);

  return deliverConvergent(
    {
      title: procedure.title,
      observe: (inner) => observe(kernel, inner),
      converged: (first, inner) => confirm(kernel, procedure.readback, input, first, inner),
      accepted,
      notReady: (view) =>
        view.screen === procedure.startScreen
          ? undefined
          : `Station shows ${view.screen ?? 'an unknown screen'}; ${procedure.title} starts on ${procedure.startScreen}`,
      preconditions: (first, inner) =>
        confirm(kernel, procedure.preconditions, input, first, inner),
      act: (view, inner) => runProcedure(kernel, effect, procedure, view, inner),
    },
    signal,
  );
}
