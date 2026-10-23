import { expired, isFinished, service, type Context } from './state';
import { allSettled, awaited } from './steps';

/**
 * Instances to advance now, and waiting ones with the types they watch. An instance awaiting
 * effects is due once they settled or one was held or released, so an idle pass writes nothing.
 */
export function dueInstances(ctx: Context) {
  const { definitions, now } = service(ctx);
  const at = now();
  const items = [];
  for (const instance of Object.values(ctx.state.instances)) {
    if (isFinished(instance) || instance.status === 'stalled' || expired(instance, at)) continue;
    const step = definitions.get(instance.workflow)?.workflow.steps[instance.index];
    let ready = instance.nextAt <= at || at >= instance.deadline;
    if (instance.pending && instance.status === 'running') {
      const effects = awaited(instance, ctx);
      const held = effects.some((effect) => effect?.heldAt !== undefined);
      ready = allSettled(effects) || held !== !!instance.held || at >= instance.deadline;
    }
    const watch =
      instance.status === 'waiting' && step?.kind === 'wait' && step.watch?.length
        ? { types: [...step.watch], cursor: instance.wait?.cursor ?? 0 }
        : undefined;
    if (!ready && !watch) continue;
    items.push({
      id: instance.id,
      seq: instance.seq,
      starter: instance.starter,
      grant: {
        operations: [...instance.grant.operations],
        ...(instance.grant.resources ? { resources: [...instance.grant.resources] } : {}),
        ...(instance.grant.creates ? { creates: [...instance.grant.creates] } : {}),
        expiresAt: instance.grant.expiresAt,
      },
      now: ready,
      ...(watch ? { watch } : {}),
    });
  }
  return { items };
}
