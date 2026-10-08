import { z } from 'zod';
import { operation } from './operation';
import {
  id,
  revision,
  station,
  stationRoleSchema,
  bridgeModeSchema,
  seatSchema,
  syncSchema,
  observationSchema,
  readingSchema,
  stopSchema,
  countReportSchema,
  orderSchema,
  reasonSchema,
  desiredSchema,
  outcomeSchema,
} from './schemas';

const operate = { action: 'operate', resourceType: 'Station' };

/** Commands of the line-station module, in catalog order. */
export const commandOperations = {
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
