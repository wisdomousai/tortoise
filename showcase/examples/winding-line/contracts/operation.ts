import type { z } from 'zod';
import { defineCapability, jsonSchema } from '@tortoise/contracts';

/** What each operation tells people and agents; every operation must have an entry. */
const descriptions: Readonly<Record<string, string>> = {
  'line.station.list':
    'List stations where you hold a role with machine state, open stop, attention count, bridge mode and who holds the station screen.',
  'line.station.get':
    'Read one station: observed readings with source, confidence and freshness, the current order, desired versus observed recipe, the open stop and bridge state. Observed values come from the station screen and may be stale; check `stale` and `status` before relying on them. Pass countersRevision as counters:<id> in a count confirmation expectedRevisions map.',
  'line.stop.list':
    'List machine stops detected at a station, newest first, with classification and MES synchronization status. Filter to open (unclassified) stops with `unclassified`.',
  'line.attention.list':
    'List what needs a person at a station: readings the bridge could not read with confidence, and screen procedures that were interrupted and must be reconciled.',
  'line.reason.list': 'List stop reasons published by the MES.',
  'line.order.list':
    'List MES orders released to a station, and the active one, with material and recipe.',
  'line.control.get':
    'Station bridge only: read the bridge mode and who holds the station screen. The bridge reads this before every screen action.',
  'line.order.start':
    'Start a released MES order at a station: records the desired recipe and asks the station bridge to load it through the station screen. Needs a person at the station (operator or supervisor, not an agent): the receipt proves the request, the station shows the result later. Starts only when the machine is stopped.',
  'line.stop.classify':
    'Classify a detected machine stop with an MES stop reason as operator or supervisor. The classification is forwarded to the MES; a rejected classification can be classified again.',
  'line.count.confirm':
    'Confirm the good and scrap counters the station shows for the active order and forward them to the MES. Uses only confident or operator-verified readings; pass counters:<id> (countersRevision from line.station.get) in expectedRevisions so counts that changed after you looked conflict instead of being sent.',
  'line.reading.confirm':
    'Confirm or correct a reading the bridge was unsure about, as a person at the station. The value becomes operator-verified and resolves the attention item.',
  'line.effect.reconcile':
    'Resolve an interrupted screen procedure as a person who checked the station: applied=true records it as done; applied=false lets the bridge run it again.',
  'line.bridge.set-mode':
    'Set what the station bridge may do as supervisor: monitor-only (observe), assist (procedures of risk level none) or actuate (all declared procedures).',
  'line.control.request':
    'Take over the station screen from the bridge (controlledBy=operator) or hand it back (controlledBy=agent) as operator or supervisor. Taking over stops any running screen procedure before its next action.',
  'line.observation.ingest':
    'Station bridge only: submit what the station screen currently shows. Stable confident readings become observed values, unsure ones become attention items, and machine state changes open and close stops.',
};

/**
 * Define one winding-line capability with its description, UI binding or exception, and outbox
 * target. Throws at module load when the description is missing.
 */
export function operation<
  const Id extends string,
  const Kind extends 'command' | 'query',
  I extends z.ZodType,
  O extends z.ZodType,
>(
  name: Id,
  kind: Kind,
  input: I,
  output: O,
  permission: { action: string; resourceType: string },
  options: {
    dependencies: readonly string[];
    target?: 'mes' | 'legacy-hmi';
    exception?: string;
    binding?: string;
  },
) {
  const description = descriptions[name];
  if (!description) throw new Error(`Missing operation description: ${name}`);
  return defineCapability({
    id: name,
    kind,
    description,
    input: jsonSchema(input),
    output: jsonSchema(output),
    permission,
    dependencies: options.dependencies,
    ui: options.exception ? { exception: options.exception } : { binding: options.binding ?? name },
    // Screen procedures run on `legacy-hmi:<station>`; the declared target names the kind.
    ...(options.target
      ? { integration: { target: options.target, delivery: 'outbox' as const } }
      : {}),
  });
}
