import { z } from 'zod';
import { operation } from './operation';
import { mesTarget } from './target';
import {
  id,
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

/** Queries of the winding-line module, in catalog order. */
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
    { dependencies: ['sync'] },
  ),
  orderList: operation(
    'line.order.list',
    'query',
    station,
    z.strictObject({ items: z.array(orderSchema) }),
    stationRead,
    { dependencies: ['station', 'order'] },
  ),
  syncStatus: mesTarget.status,
  controlGet: operation(
    'line.control.get',
    'query',
    station,
    z.strictObject({ mode: bridgeModeSchema, seat: seatSchema }),
    { action: 'control', resourceType: 'StationBridge' },
    { dependencies: ['station'], exception: 'station bridge principal (screen controller)' },
  ),
} as const;
