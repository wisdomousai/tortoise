import { z } from 'zod';

/**
 * The answers and notifications a driver sends, checked before the host uses them. A driver is
 * deployment code, not a trusted library: a malformed answer is a protocol error, never a value.
 */

const text = (max: number) => z.string().min(1).max(max);
const fieldValue = z.union([z.string().max(4096), z.number(), z.boolean(), z.null()]);

/** The unit a driver talks to, reported at the handshake and recorded with every reading. */
export const deviceIdentitySchema = z.strictObject({
  serial: text(128).optional(),
  firmware: text(128).optional(),
  model: text(128).optional(),
});

export const initializeAnswer = z.strictObject({
  driver: z.strictObject({ id: text(128), version: text(64) }),
  contract: z.strictObject({ digest: z.string().regex(/^[0-9a-f]{64}$/) }),
  /** Changes on every driver start; events carry it, so the host notices a restart. */
  session: text(128),
  devices: z.array(deviceIdentitySchema).max(64).default([]),
});
export type InitializeAnswer = z.output<typeof initializeAnswer>;

export const stateAnswer = z.strictObject({
  values: z.record(z.string(), fieldValue),
  /** 0–1 per field where the instrument reports it; 1 otherwise. */
  confidence: z.record(z.string(), z.number().min(0).max(1)).default({}),
  /** Driver clock, milliseconds since the epoch. */
  at: z.number(),
});
export type StateAnswer = z.output<typeof stateAnswer>;

export const invokeAnswer = z.strictObject({
  /** The equipment's reference for what it did, if it has one. */
  ref: text(256).optional(),
  result: z.json().optional(),
});
export type InvokeAnswer = z.output<typeof invokeAnswer>;

export const lookupAnswer = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('accepted'), ref: text(256).optional() }),
  z.strictObject({ status: z.literal('rejected'), code: text(64), message: text(500) }),
  z.strictObject({ status: z.literal('unknown') }),
  z.strictObject({ status: z.literal('uncertain'), reason: text(500) }),
]);
export type LookupAnswer = z.output<typeof lookupAnswer>;

export const eventNotification = z.strictObject({
  session: text(128),
  seq: z.number().int().nonnegative(),
  name: text(128),
  payload: z.json().optional(),
  at: z.number(),
  /** Index into the handshake's `devices`, when the driver talks to several. */
  device: z.number().int().nonnegative().optional(),
});
export type EventNotification = z.output<typeof eventNotification>;
