import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';

/**
 * Line station contracts: operator workstations whose machine software can only be read and
 * driven through its screen, on top of a homebrew MES that owns orders and stop reasons.
 *
 * Three principals touch this module. People (operator, supervisor, viewer per station) use the
 * station surface and MCP. Each station's bridge (`station-bridge:<station>`) submits what the
 * screen shows and settles screen procedures. The MES integration syncs orders and reasons and
 * settles forwarded records. Neither integration principal can do what people do.
 */
const id = z.string().min(1).max(128);
const revision = z.number().int().min(0);
const timestamp = z.number().int().min(0);
export const stationRoleSchema = z.enum(['operator', 'supervisor', 'viewer']);
export const bridgeModeSchema = z.enum(['monitor-only', 'assist', 'actuate']);
export const seatSchema = z.enum(['operator', 'agent', 'idle']);
/** `held`: a screen procedure was interrupted and a person must say whether it took effect. */
export const syncSchema = z.enum(['pending', 'held', 'accepted', 'rejected']);
const rejection = z.strictObject({ code: z.string(), message: z.string() });
const fieldValue = z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()]);
const model = z.strictObject({
  id: z.string().max(200),
  version: z.string().max(100).optional(),
  digest: z.string().max(200).optional(),
});

/** One reading as the bridge submits it (see `Observation` in @agent-native/station). */
const fieldDeclaration = z.strictObject({
  type: z.enum(['number', 'text', 'enum', 'boolean']),
  options: z.array(z.string().max(100)).max(100).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
  unit: z.string().max(16).optional(),
});
const profileIdentity = z.strictObject({ id: z.string().max(64), version: z.string().max(32) });
export const observedReadingSchema = z.strictObject({
  field: z.string().min(1).max(64),
  value: fieldValue,
  confidence: z.number().min(0).max(1),
  extractor: z.string().min(1).max(64),
  model: model.optional(),
  observedAt: timestamp,
  frameDigest: z.string().min(1).max(128),
  status: z.enum(['observed', 'uncertain']),
  minConfidence: z.number().min(0).max(1),
  /** The profile's field declaration; without it the type is inferred from the value. */
  declared: fieldDeclaration.optional(),
});
export const observationSchema = z.strictObject({
  station: id,
  profile: profileIdentity,
  screen: z.string().max(64).nullable(),
  observedAt: timestamp,
  frameDigest: z.string().min(1).max(128),
  localInput: z.boolean(),
  readings: z.array(observedReadingSchema).max(100),
});
/** A field value as recorded, with the provenance a reader needs to judge it. */
export const readingSchema = z.strictObject({
  value: fieldValue,
  confidence: z.number(),
  /** Extractor id, or `operator` for a person's confirmation. */
  source: z.string(),
  model: model.optional(),
  observedAt: timestamp,
  /** Frame and profile that produced an observed value, so it can be explained afterwards. */
  frameDigest: z.string().optional(),
  profile: profileIdentity.optional(),
  status: z.enum(['observed', 'operator-verified']),
  verifiedBy: id.optional(),
  stale: z.boolean(),
});
export const stopSchema = z.strictObject({
  id,
  revision,
  station: id,
  orderId: id.optional(),
  state: z.enum(['STOPPED', 'ALARM']),
  alarm: z.string().optional(),
  startedAt: timestamp,
  endedAt: timestamp.optional(),
  reason: z.string().optional(),
  classifiedBy: id.optional(),
  classifiedAt: timestamp.optional(),
  sync: syncSchema.optional(),
  sorRef: z.string().optional(),
  rejection: rejection.optional(),
});
export const countReportSchema = z.strictObject({
  id,
  station: id,
  orderId: id,
  good: z.number(),
  scrap: z.number(),
  observedAt: timestamp,
  provenance: z.enum(['observed', 'operator-verified']),
  confirmedBy: id,
  confirmedAt: timestamp,
  sync: syncSchema,
  sorRef: z.string().optional(),
  rejection: rejection.optional(),
});
export const attentionSchema = z.strictObject({
  id,
  station: id,
  kind: z.enum(['reading', 'reconcile']),
  title: z.string(),
  detail: z.string().optional(),
  field: z.string().optional(),
  proposed: fieldValue.optional(),
  /** How a correction must be entered: the field's declared type, options and format. */
  value: fieldDeclaration.optional(),
  confidence: z.number().optional(),
  source: z.string().optional(),
  frameDigest: z.string().optional(),
  profile: profileIdentity.optional(),
  effectId: id.optional(),
  createdAt: timestamp,
});
export const orderSchema = z.strictObject({
  id,
  station: id,
  material: z.string().max(64),
  materialText: z.string().max(200),
  recipe: z.string().max(64),
  quantity: z.number().min(0),
  status: z.enum(['released', 'active', 'completed']),
});
export const reasonSchema = z.strictObject({
  code: z.string().min(1).max(32),
  text: z.string().max(200),
  category: z.enum(['planned', 'unplanned', 'quality']),
});
const desiredSchema = z.strictObject({
  recipe: z.string(),
  orderId: id,
  requestedBy: id,
  requestedAt: timestamp,
  sync: syncSchema,
  /** The station shows the desired recipe (confident readback). */
  converged: z.boolean(),
  holdReason: z.string().optional(),
  rejection: rejection.optional(),
});
const bridgeSchema = z.strictObject({
  mode: bridgeModeSchema,
  seat: seatSchema,
  seatChangedBy: id.optional(),
  seatChangedAt: timestamp.optional(),
  screen: z.string().nullable().optional(),
  observedAt: timestamp.optional(),
  profile: z.strictObject({ id: z.string(), version: z.string() }).optional(),
  localInputAt: timestamp.optional(),
  /** No observation within the freshness window: everything shown may be outdated. */
  stale: z.boolean(),
});
const stationSummaryShape = {
  id,
  revision,
  name: z.string(),
  line: z.string(),
  role: stationRoleSchema,
  machine: z.string().optional(),
  openStop: z.boolean(),
  attention: z.number().int(),
  mode: bridgeModeSchema,
  seat: seatSchema,
  stale: z.boolean(),
};
export const stationSummarySchema = z.strictObject(stationSummaryShape);
export const stationDetailSchema = z.strictObject({
  ...stationSummaryShape,
  /** Revision of the good/scrap counters; pass as counters:<id> when confirming counts. */
  countersRevision: revision,
  bridge: bridgeSchema,
  readings: z.record(z.string(), readingSchema),
  order: orderSchema.optional(),
  desired: desiredSchema.optional(),
  currentStop: stopSchema.optional(),
});
export const outcomeSchema = z.union([
  z.strictObject({ status: z.literal('accepted'), externalRef: z.string().max(256).optional() }),
  z.strictObject({
    status: z.literal('rejected'),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2000),
  }),
]);
const page = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
const station = z.strictObject({ station: id });

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
  'line.sync.status':
    'Summarize synchronization for your stations: records pending, held, accepted and rejected per target (MES and station software), recent rejections and the last MES sync.',
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
    'Set what the station bridge may do as supervisor: monitor-only (observe), assist (hazard-free procedures) or actuate (all declared procedures).',
  'line.seat.request':
    'Take over the station screen from the bridge (seat=operator) or hand it back (seat=agent) as operator or supervisor. Taking over stops any running screen procedure before its next action.',
  'line.station.set-member':
    'Grant or remove a station role (operator, supervisor, viewer) as supervisor of that station. A null role removes access. You cannot change your own role or give integration principals a role.',
  'line.observation.ingest':
    'Station bridge only: submit what the station screen currently shows. Stable confident readings become observed values, unsure ones become attention items, and machine state changes open and close stops.',
  'line.mes.sync':
    'MES integration only: apply orders and stop reasons from the MES and advance the watermark. A stale from watermark conflicts.',
  'line.effect.settle':
    'Integration only: record the outcome of a forwarded record (MES) or a screen procedure (station bridge). Each integration principal settles only its own target.',
};

function operation<
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

const stationRead = { action: 'read', resourceType: 'Station' };
const operate = { action: 'operate', resourceType: 'Station' };
export const operations = {
  stationList: operation(
    'line.station.list',
    'query',
    z.strictObject({}),
    z.strictObject({ items: z.array(stationSummarySchema) }),
    stationRead,
    { dependencies: ['station', 'stop', 'attention'] },
  ),
  stationGet: operation('line.station.get', 'query', station, stationDetailSchema, stationRead, {
    dependencies: ['station', 'stop', 'order', 'attention'],
  }),
  stopList: operation(
    'line.stop.list',
    'query',
    z.strictObject({ station: id, unclassified: z.boolean().optional(), ...page }),
    z.strictObject({ items: z.array(stopSchema), count: z.number().int() }),
    stationRead,
    { dependencies: ['station', 'stop'] },
  ),
  attentionList: operation(
    'line.attention.list',
    'query',
    station,
    z.strictObject({ items: z.array(attentionSchema) }),
    stationRead,
    { dependencies: ['station', 'attention'] },
  ),
  reasonList: operation(
    'line.reason.list',
    'query',
    z.strictObject({}),
    z.strictObject({ items: z.array(reasonSchema) }),
    { action: 'read', resourceType: 'StopReason' },
    { dependencies: ['mes'] },
  ),
  orderList: operation(
    'line.order.list',
    'query',
    station,
    z.strictObject({ items: z.array(orderSchema) }),
    stationRead,
    { dependencies: ['station', 'order'] },
  ),
  syncStatus: operation(
    'line.sync.status',
    'query',
    z.strictObject({}),
    z.strictObject({
      watermark: z.string().optional(),
      lastSyncAt: timestamp.optional(),
      targets: z.array(
        z.strictObject({
          target: z.string(),
          pending: z.number().int(),
          held: z.number().int(),
          retrying: z.number().int(),
          accepted: z.number().int(),
          rejected: z.number().int(),
        }),
      ),
      rejections: z.array(
        z.strictObject({
          resource: z.string(),
          station: id,
          code: z.string(),
          message: z.string(),
        }),
      ),
    }),
    { action: 'read', resourceType: 'Synchronization' },
    { dependencies: ['station', 'stop', 'count', 'mes'], binding: 'line.station.bridge' },
  ),
  controlGet: operation(
    'line.control.get',
    'query',
    station,
    z.strictObject({ mode: bridgeModeSchema, seat: seatSchema }),
    { action: 'control', resourceType: 'StationBridge' },
    { dependencies: ['station'], exception: 'station bridge principal (screen controller)' },
  ),
  orderStart: operation(
    'line.order.start',
    'command',
    z.strictObject({ station: id, orderId: id }),
    z.strictObject({ station: id, revision, desired: desiredSchema }),
    operate,
    { dependencies: ['station', 'order'], target: 'legacy-hmi' },
  ),
  stopClassify: operation(
    'line.stop.classify',
    'command',
    z.strictObject({ stopId: id, reason: z.string().min(1).max(32) }),
    stopSchema,
    { action: 'classify', resourceType: 'Stop' },
    { dependencies: ['stop'], target: 'mes' },
  ),
  countConfirm: operation('line.count.confirm', 'command', station, countReportSchema, operate, {
    dependencies: ['station', 'count'],
    target: 'mes',
  }),
  readingConfirm: operation(
    'line.reading.confirm',
    'command',
    z.strictObject({
      attentionId: id,
      value: z.union([z.string().min(1).max(1_000), z.number(), z.boolean()]),
    }),
    z.strictObject({ station: id, field: z.string(), reading: readingSchema }),
    operate,
    { dependencies: ['station', 'attention'] },
  ),
  effectReconcile: operation(
    'line.effect.reconcile',
    'command',
    z.strictObject({ effectId: id, applied: z.boolean() }),
    z.strictObject({ station: id, sync: syncSchema }),
    operate,
    { dependencies: ['station', 'attention'] },
  ),
  bridgeSetMode: operation(
    'line.bridge.set-mode',
    'command',
    z.strictObject({ station: id, mode: bridgeModeSchema }),
    z.strictObject({ station: id, mode: bridgeModeSchema }),
    { action: 'administer', resourceType: 'StationBridge' },
    { dependencies: ['station'], binding: 'line.station.bridge' },
  ),
  seatRequest: operation(
    'line.seat.request',
    'command',
    z.strictObject({ station: id, seat: z.enum(['operator', 'agent']) }),
    z.strictObject({ station: id, seat: seatSchema }),
    operate,
    { dependencies: ['station'] },
  ),
  stationSetMember: operation(
    'line.station.set-member',
    'command',
    z.strictObject({ station: id, principalId: id, role: stationRoleSchema.nullable() }),
    z.strictObject({ station: id, members: z.record(z.string(), stationRoleSchema) }),
    { action: 'administer', resourceType: 'Station' },
    { dependencies: ['station'], binding: 'line.station.bridge' },
  ),
  observationIngest: operation(
    'line.observation.ingest',
    'command',
    observationSchema,
    z.strictObject({
      station: id,
      applied: z.boolean(),
      openedStop: id.optional(),
      closedStop: id.optional(),
    }),
    { action: 'observe', resourceType: 'Station' },
    {
      dependencies: ['station', 'stop', 'attention'],
      exception: 'station bridge principal (screen observer)',
    },
  ),
  mesSync: operation(
    'line.mes.sync',
    'command',
    z.strictObject({
      from: z.string().max(256).optional(),
      to: z.string().min(1).max(256),
      orders: z.array(orderSchema.omit({ status: true }).extend({ closed: z.boolean() })).max(200),
      reasons: z.array(reasonSchema).max(200).optional(),
    }),
    z.strictObject({ watermark: z.string(), orders: z.number().int() }),
    { action: 'sync', resourceType: 'Order' },
    { dependencies: ['order', 'mes'], exception: 'MES integration principal (inbound sync job)' },
  ),
  effectSettle: operation(
    'line.effect.settle',
    'command',
    z.strictObject({ effectId: id, outcome: outcomeSchema }),
    z.strictObject({ resource: z.string(), sync: syncSchema }),
    { action: 'settle', resourceType: 'Synchronization' },
    {
      dependencies: ['station', 'stop', 'count'],
      exception: 'integration principals (outbox dispatchers)',
    },
  ),
} as const;

export const lineStationModule = defineModule({
  id: 'line-station',
  capabilities: Object.values(operations),
  requirements: {
    network: [
      {
        id: 'station-screen',
        purpose:
          'Reach the legacy station software screen to observe it and run declared procedures (web HMI, VNC or RDP, per site).',
        direction: 'egress',
        scope: 'site',
        protocol: 'https',
        targets: ['legacy-hmi'],
        dataClasses: ['screen-input', 'recipe-selection'],
        availability: 'optional',
        offline: 'queue',
      },
      {
        id: 'mes-api',
        purpose:
          'Forward stop classifications and count confirmations to the MES and pull orders and reasons.',
        direction: 'egress',
        scope: 'site',
        protocol: 'https',
        targets: ['mes'],
        dataClasses: ['stop-classification', 'count-confirmation'],
        availability: 'required',
        offline: 'queue',
      },
    ],
  },
  workflows: [
    {
      id: 'explain-stop',
      operations: ['line.stop.list', 'line.station.get', 'line.reason.list', 'line.stop.classify'],
      text: 'Find the unclassified stop, read the station state and alarm text at the stop and the MES stop reasons, and propose the reason that the alarm and history support, with your evidence. Classify only after the operator confirms the reason; never classify a stop from a guess. If no reason fits, say so.',
    },
    {
      id: 'shift-handover',
      operations: [
        'line.station.list',
        'line.station.get',
        'line.stop.list',
        'line.attention.list',
        'line.sync.status',
      ],
      text: 'Summarize each station for the next shift: active order and counters with their freshness and source, stops and their classification, open attention items and held screen procedures, and records the MES rejected. Report observed values as observed (with time and confidence), not as facts.',
    },
  ],
});
