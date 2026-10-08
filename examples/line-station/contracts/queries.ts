import { z } from 'zod';
import { operation } from './operation';
import {
  id,
  timestamp,
  page,
  station,
  bridgeModeSchema,
  seatSchema,
  stopSchema,
  attentionSchema,
  orderSchema,
  reasonSchema,
  stationSummarySchema,
  stationDetailSchema,
} from './schemas';

const stationRead = { action: 'read', resourceType: 'Station' };

/** Queries of the line-station module, in catalog order. */
export const queryOperations = {
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
} as const;
