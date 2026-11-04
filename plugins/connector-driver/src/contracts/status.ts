import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';

/**
 * The driver plugin's one query: what each declared driver is, whether it runs, which units it
 * reported and what its actions may do. It reads host memory, never workspace state, and changes
 * nothing. Authorized like any other operation (`read` on `Driver`) and audited.
 */
const count = z.number().int().min(0);
const deliverySchema = z.enum(['idempotent', 'convergent', 'once']);
const riskSchema = z.enum(['none', 'low', 'operator-present']);

export const driverStatusSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  version: z.string(),
  /** The contract digest the driver must return at its handshake. */
  digest: z.string(),
  state: z.enum(['stopped', 'starting', 'ready', 'backing-off']),
  /** What the running driver reported at its handshake. */
  driver: z.strictObject({ id: z.string(), version: z.string() }).optional(),
  session: z.string().optional(),
  devices: z.array(
    z.strictObject({
      serial: z.string().optional(),
      firmware: z.string().optional(),
      model: z.string().optional(),
    }),
  ),
  starts: count,
  problems: count,
  lastError: z.string().optional(),
  actions: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      delivery: deliverySchema,
      risk: riskSchema,
    }),
  ),
});

export const driverOperations = {
  statusGet: defineCapability({
    id: 'driver.status.get',
    kind: 'query',
    description:
      'Read every hardware driver this installation declares: whether its process runs, its contract version and digest, the units it reported (serial, firmware), restart and problem counts, and each action with its delivery mode and risk level. Use it to tell whether equipment is reachable before planning an action; it never acts on the equipment.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ drivers: z.array(driverStatusSchema) })),
    permission: { action: 'read', resourceType: 'Driver' },
    dependencies: ['driver'],
    ui: { binding: 'driver-status' },
  }),
} as const;

export const driverModule = defineModule({
  id: 'driver',
  capabilities: Object.values(driverOperations),
});

export type DriverStatusView = z.infer<typeof driverStatusSchema>;
