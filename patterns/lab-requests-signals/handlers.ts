import { ApplicationError } from '@agent-native/contracts';
import { own, put, type HandlerContext, type HandlerContribution } from '@agent-native/runtime';
import { chamberOperations, type Chamber, type Condition } from './contracts';
import type { ChamberDefinition, LabSignalsRoot, Quantity } from './domain';

type Context = HandlerContext<LabSignalsRoot, unknown>;

const within = (condition: Condition | undefined, setpoint: number, tolerance: number) =>
  condition?.status === 'observed' &&
  condition.value !== null &&
  Math.abs(condition.value - setpoint) <= tolerance;

function present(definition: ChamberDefinition, ctx: Context): Chamber {
  const conditions = own(ctx.state.chambers.conditions, definition.id) ?? {};
  return {
    id: definition.id,
    label: definition.label,
    setpoint: definition.setpoint,
    tolerance: definition.tolerance,
    temperature: conditions.temperature ?? null,
    humidity: conditions.humidity ?? null,
    conditioned:
      within(
        conditions.temperature,
        definition.setpoint.temperature,
        definition.tolerance.temperature,
      ) && within(conditions.humidity, definition.setpoint.humidity, definition.tolerance.humidity),
  };
}

/**
 * The next condition after one debounced reading, or `undefined` when nothing changes. An observed
 * number replaces the value; an uncertain reading keeps the last observed value and only marks it
 * uncertain, so a flapping connection never writes a value the source did not confirm.
 */
function next(
  current: Condition | undefined,
  reading: { value: unknown; status: 'observed' | 'uncertain' },
  observedAt: number,
): Condition | undefined {
  if (reading.status === 'observed' && typeof reading.value === 'number') {
    if (current?.status === 'observed' && current.value === reading.value) return undefined;
    return { value: reading.value, since: observedAt, status: 'observed' };
  }
  if (current?.status === 'uncertain') return undefined;
  return { value: current?.value ?? null, since: current?.since ?? null, status: 'uncertain' };
}

/** The chamber module's handlers over the whole state: placing reads the lab's test requests. */
export function createChamberHandlers(
  chambers: readonly ChamberDefinition[],
): HandlerContribution<LabSignalsRoot, unknown>[] {
  const byId = new Map(chambers.map((chamber) => [chamber.id, chamber]));
  const byField = new Map<string, { chamber: string; quantity: Quantity }>();
  for (const chamber of chambers)
    for (const quantity of ['temperature', 'humidity'] as const)
      byField.set(`${chamber.id}.${quantity}`, { chamber: chamber.id, quantity });
  return [
    {
      capability: chamberOperations.chamberList,
      handle: (_input: unknown, ctx: Context) => ({
        items: chambers.map((chamber) => present(chamber, ctx)),
      }),
    },
    {
      capability: chamberOperations.chamberConditions,
      handle: (input: { request: string }, ctx: Context) => {
        const placed = own(ctx.state.chambers.placements, input.request);
        const definition = placed === undefined ? undefined : byId.get(placed);
        return { chamber: definition ? present(definition, ctx) : null };
      },
    },
    {
      capability: chamberOperations.chamberPlace,
      handle: (input: { request: string; chamber: string }, ctx: Context) => {
        if (!own(ctx.state.labRequests.requests, input.request))
          throw new ApplicationError('NOT_FOUND', 'Test request not found');
        if (!byId.has(input.chamber)) throw new ApplicationError('NOT_FOUND', 'Chamber not found');
        put(ctx.state.chambers.placements, input.request, input.chamber);
        ctx.change(`chamber-placement:${input.request}`);
        return { request: input.request, chamber: input.chamber };
      },
    },
    {
      capability: chamberOperations.readingIngest,
      handle: (
        input: {
          observedAt: number;
          readings: { field: string; value: unknown; status: 'observed' | 'uncertain' }[];
        },
        ctx: Context,
      ) => {
        const changed = new Set<string>();
        for (const reading of input.readings) {
          // A field no chamber declares is ignored rather than refused, so a source that
          // publishes more than the lab reads does not block the readings it does.
          const target = byField.get(reading.field);
          if (!target) continue;
          const conditions = own(ctx.state.chambers.conditions, target.chamber) ?? {};
          const condition = next(conditions[target.quantity], reading, input.observedAt);
          if (!condition) continue;
          put(ctx.state.chambers.conditions, target.chamber, {
            ...conditions,
            [target.quantity]: condition,
          });
          changed.add(target.chamber);
        }
        for (const chamber of changed) ctx.change(`chamber:${chamber}`);
        return { changed: [...changed] };
      },
    },
  ] as HandlerContribution<LabSignalsRoot, unknown>[];
}
