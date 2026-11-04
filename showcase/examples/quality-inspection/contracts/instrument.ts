import { z } from 'zod';
import { jsonSchema } from '@tortoise/contracts';
import { defineDriverContract } from '@tortoise/connector-driver/contracts';

/** What the instrument sends when the inspector presses its data button. */
export const instrumentMeasurementSchema = z.strictObject({
  value: z.number(),
  unit: z.string().min(1).max(16),
});

/**
 * The capture station's gauge or scale, read through a driver on the station host. It only
 * reports: it has no actions, so nothing the application does can move it. `measurement.taken`
 * is sent once per press of the instrument's data button; the state fields are its live display.
 */
export const instrumentContract = defineDriverContract({
  id: 'measuring-instrument',
  version: '1.0.0',
  title: 'Measuring instrument',
  process: {
    id: 'instrument-driver',
    purpose: "Reads the capture station's gauge or scale over its serial data output.",
    availability: 'optional',
  },
  devices: [
    {
      id: 'instrument-port',
      kind: 'serial',
      purpose: 'Gauge or scale data output (RS-232 or USB serial).',
      availability: 'optional',
    },
  ],
  state: {
    stable: { type: 'boolean' },
    unit: { type: 'text' },
    value: { type: 'number' },
  },
  actions: {},
  events: {
    'measurement.taken': {
      kind: 'occurrence',
      payload: jsonSchema(instrumentMeasurementSchema),
      maxRateHz: 10,
    },
  },
});
