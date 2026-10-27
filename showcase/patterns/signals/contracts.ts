import { z } from 'zod';
import {
  defineCapability,
  defineModule,
  jsonSchema,
  recordKeySchema,
} from '@agent-native/contracts';
import { mqttBroker } from '@agent-native/connector-mqtt/contracts';
import { opcUaServer } from '@agent-native/connector-opcua/contracts';

/** The OPC UA server of the chamber controllers; the site policy binds its address. */
export const CHAMBER_GATEWAY = 'chamber-gateway';
/** The MQTT broker the humidity edge nodes publish Sparkplug B to; the site policy binds it. */
export const CHAMBER_BROKER = 'chamber-broker';

export const chamberGateway = opcUaServer({
  id: 'chamber-gateway',
  destination: CHAMBER_GATEWAY,
  description: 'Climate chamber controllers: chamber temperature, read over OPC UA',
  dataClasses: ['process values'],
});
export const chamberBroker = mqttBroker({
  id: 'chamber-broker',
  destination: CHAMBER_BROKER,
  description: 'Humidity edge nodes: chamber humidity, read as Sparkplug B',
  dataClasses: ['process values'],
});

/**
 * One measured quantity of a chamber. `value` and `since` are the last observed reading and when
 * it was first observed; `uncertain` means the source no longer confirms it (a lost connection,
 * a dead edge node, a bad status), so it is shown to people but not taken as current.
 */
export const conditionSchema = z.strictObject({
  value: z.number().nullable(),
  since: z.number().int().nonnegative().nullable(),
  status: z.enum(['observed', 'uncertain']),
});
export type Condition = z.output<typeof conditionSchema>;

/**
 * A climate chamber where samples are conditioned before testing, with its setpoint and
 * tolerance. `conditioned` is true when both quantities are observed and within tolerance.
 */
export const chamberSchema = z.strictObject({
  id: recordKeySchema,
  label: z.string(),
  setpoint: z.strictObject({ temperature: z.number(), humidity: z.number() }),
  tolerance: z.strictObject({ temperature: z.number(), humidity: z.number() }),
  temperature: conditionSchema.nullable(),
  humidity: conditionSchema.nullable(),
  conditioned: z.boolean(),
});
export type Chamber = z.output<typeof chamberSchema>;

const readingSchema = z.strictObject({
  field: z.string().max(200),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  status: z.enum(['observed', 'uncertain']),
});

const member = { action: 'read', resourceType: 'Chamber' };

/** Climate chambers, their conditions and which chamber holds a test request's sample. */
export const chamberOperations = {
  chamberList: defineCapability({
    id: 'chamber.list',
    kind: 'query',
    description:
      'List the climate chambers with their temperature, humidity and whether each is conditioned.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ items: z.array(chamberSchema) })),
    permission: member,
    dependencies: ['chamber'],
    ui: { binding: 'chamber.list' },
  }),
  chamberConditions: defineCapability({
    id: 'chamber.conditions',
    kind: 'query',
    description:
      "The chamber that holds a test request's sample and its conditions, or null when the sample is in no chamber.",
    input: jsonSchema(z.strictObject({ request: recordKeySchema })),
    output: jsonSchema(z.strictObject({ chamber: chamberSchema.nullable() })),
    permission: member,
    dependencies: ['chamber', 'chamber-placement'],
    ui: { binding: 'chamber.conditions' },
  }),
  chamberPlace: defineCapability({
    id: 'chamber.place',
    kind: 'command',
    description:
      "Record that a test request's sample is conditioned in a chamber. Technicians only.",
    input: jsonSchema(z.strictObject({ request: recordKeySchema, chamber: recordKeySchema })),
    output: jsonSchema(z.strictObject({ request: recordKeySchema, chamber: recordKeySchema })),
    permission: { action: 'write', resourceType: 'Chamber' },
    dependencies: ['chamber-placement'],
    ui: { binding: 'chamber.place' },
    display: { label: 'Place in chamber' },
  }),
  readingIngest: defineCapability({
    id: 'chamber.reading.ingest',
    kind: 'command',
    description:
      'Record gated chamber readings from the OPC UA or MQTT observer. Only the chamber observer principal may call it.',
    input: jsonSchema(
      z.strictObject({
        source: z.enum(['opcua', 'mqtt']),
        observedAt: z.number().int().nonnegative(),
        readings: z.array(readingSchema).max(200),
      }),
    ),
    output: jsonSchema(z.strictObject({ changed: z.array(recordKeySchema) })),
    permission: { action: 'observe', resourceType: 'Chamber' },
    dependencies: ['chamber'],
    ui: { exception: 'chamber observer principal (OPC UA and MQTT observers)' },
  }),
} as const;

export const chamberModule = defineModule({
  id: 'chambers',
  capabilities: Object.values(chamberOperations),
});
