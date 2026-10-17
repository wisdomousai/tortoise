import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';

/**
 * The hub route a device posts its enrollment code to, and the device kinds the hub issues. They
 * are the device-link plugin's protocol, repeated here because this plugin never imports it; the
 * device-link tests pair the two.
 */
export const enrollPath = '/api/v1/link/enroll';
const deviceKindSchema = z.enum(['field-sync', 'attached']);

/** The hub this device is paired with, as the device records it. The credential is not here. */
export const pairingSchema = z.strictObject({
  origin: z.string().url().max(300),
  deviceId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  label: z.string().max(80),
  kind: deviceKindSchema,
  pairedAt: z.number().int().min(0),
});

export const hubLinkOperations = {
  pairingGet: defineCapability({
    id: 'hub.pairing.get',
    kind: 'query',
    description:
      'Read whether this device is paired with a hub, with which origin and under which device id, and the last pairing error.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(
      z.strictObject({
        pairing: pairingSchema.nullable(),
        lastError: z.string().max(300).optional(),
      }),
    ),
    permission: { action: 'read', resourceType: 'HubPairing' },
    ui: { binding: 'hub-pairing' },
  }),
  pairingRecord: defineCapability({
    id: 'hub.pairing.record',
    kind: 'command',
    description:
      'Record the outcome of a pairing attempt: the hub and device id after the credential was stored, or the error. Called by the pairing service after it exchanged the enrollment code.',
    input: jsonSchema(
      z.union([
        z.strictObject({ pairing: pairingSchema }),
        z.strictObject({ error: z.string().max(300) }),
      ]),
    ),
    output: jsonSchema(z.strictObject({ paired: z.boolean() })),
    permission: { action: 'write', resourceType: 'HubPairing' },
    ui: {
      exception:
        'Written by the pairing service after it exchanged the code with the hub; people pair through the plugin screen, which calls that service.',
    },
    audit: { fields: [] },
  }),
  pairingClear: defineCapability({
    id: 'hub.pairing.clear',
    kind: 'command',
    description:
      'Forget the hub on this device. The hub still lists the device until someone revokes it there. Called by the pairing service after it deleted the stored credential.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ paired: z.literal(false) })),
    permission: { action: 'write', resourceType: 'HubPairing' },
    ui: {
      exception:
        'Written by the pairing service, which first deletes the credential from the keystore; the plugin screen offers it as Unpair.',
    },
  }),
} as const;

/** Browser-safe module of the device side: the pairing record. */
export const hubLinkModule = defineModule({
  id: 'hub-link',
  capabilities: Object.values(hubLinkOperations),
});
