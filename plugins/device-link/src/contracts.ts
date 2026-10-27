import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';

/** The hub route a device posts its enrollment code to; it returns the device credential once. */
export const enrollPath = '/api/v1/link/enroll';

const id = z.string().regex(/^[a-z0-9-]{1,64}$/);
const label = z
  .string()
  .regex(/^\S(.*\S)?$/)
  .max(80);
const timestamp = z.number().int().min(0);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const operation = z.string().min(1).max(200);

/**
 * `field-sync`: a field device with its own workspace; it acts as principal `device:<id>` and may
 * call only the sync operations the hub's settings name. `attached`: a tablet that shows the
 * hub's screens; it acts as the person who enrolled it, narrowed to the enrollment's operations.
 */
export const deviceKinds = ['field-sync', 'attached'] as const;
export const deviceKindSchema = z.enum(deviceKinds);

export const deviceSchema = z.strictObject({
  id,
  label,
  kind: deviceKindSchema,
  /** Who enrolled it; an attached device acts as this principal. */
  enrolledBy: z.string(),
  enrolledAt: timestamp,
  revokedAt: timestamp.optional(),
});
export const enrollmentSchema = z.strictObject({
  id,
  label,
  kind: deviceKindSchema,
  createdAt: timestamp,
  expiresAt: timestamp,
  redeemedAt: timestamp.optional(),
  deviceId: id.optional(),
});

export const deviceLinkOperations = {
  enrollmentCreate: defineCapability({
    id: 'link.enrollment.create',
    kind: 'command',
    description:
      'Start pairing a device: returns a one-use enrollment code, valid for ten minutes, that the device exchanges for its own credential. `field-sync` devices deliver captures; `attached` tablets show these screens as the enrolling person, limited to `operations` when given.',
    input: jsonSchema(
      z.strictObject({
        label,
        kind: deviceKindSchema,
        operations: z.array(operation).max(200).optional(),
      }),
    ),
    output: jsonSchema(
      z.strictObject({ enrollmentId: id, code: z.string(), expiresAt: timestamp }),
    ),
    permission: { action: 'enroll', resourceType: 'Device' },
    ui: { binding: 'device-enroll' },
    audit: { fields: ['label', 'kind', 'operations'] },
  }),
  enrollmentRedeem: defineCapability({
    id: 'link.enrollment.redeem',
    kind: 'command',
    description:
      "Exchange an enrollment code for a device record holding the digest of a new device credential. Called only by the plugin's enrollment route, which generates the credential and never stores it.",
    input: jsonSchema(z.strictObject({ code: z.string().max(64), tokenDigest: digest })),
    output: jsonSchema(z.strictObject({ device: deviceSchema })),
    permission: { action: 'redeem', resourceType: 'Device' },
    ui: {
      exception:
        'Called by the enrollment route on behalf of a device presenting its code; people start pairing with link.enrollment.create.',
    },
    audit: { fields: [] },
  }),
  deviceList: defineCapability({
    id: 'link.device.list',
    kind: 'query',
    description:
      'List paired and revoked devices and open enrollments, without codes or credentials.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(
      z.strictObject({ devices: z.array(deviceSchema), enrollments: z.array(enrollmentSchema) }),
    ),
    permission: { action: 'read', resourceType: 'Device' },
    ui: { binding: 'device-list' },
  }),
  deviceRevoke: defineCapability({
    id: 'link.device.revoke',
    kind: 'command',
    description:
      'Revoke a device: its credential stops working at its next request. Records it already delivered stay; records still on the device stay pending there until it is paired again.',
    input: jsonSchema(z.strictObject({ deviceId: id })),
    output: jsonSchema(z.strictObject({ device: deviceSchema })),
    permission: { action: 'revoke', resourceType: 'Device' },
    ui: { binding: 'device-revoke' },
    audit: { fields: ['deviceId'] },
  }),
  deviceRename: defineCapability({
    id: 'link.device.rename',
    kind: 'command',
    description: 'Change the label a device is listed under.',
    input: jsonSchema(z.strictObject({ deviceId: id, label })),
    output: jsonSchema(z.strictObject({ device: deviceSchema })),
    permission: { action: 'rename', resourceType: 'Device' },
    ui: { binding: 'device-rename' },
    audit: { fields: ['deviceId', 'label'] },
  }),
  credentialResolve: defineCapability({
    id: 'link.credential.resolve',
    kind: 'query',
    description:
      'Find the active device a credential digest belongs to. Called only by the plugin when a request presents a device credential.',
    input: jsonSchema(z.strictObject({ tokenDigest: digest })),
    output: jsonSchema(
      z.strictObject({
        device: deviceSchema.extend({ operations: z.array(operation).optional() }).nullable(),
      }),
    ),
    permission: { action: 'resolve', resourceType: 'Device' },
    ui: {
      exception:
        'Called by the host for every request that presents a device credential; people see devices through link.device.list.',
    },
  }),
} as const;

/** Browser-safe module of the hub side: enrollment, the device list and credential lookups. */
export const deviceLinkModule = defineModule({
  id: 'device-link',
  capabilities: Object.values(deviceLinkOperations),
});
