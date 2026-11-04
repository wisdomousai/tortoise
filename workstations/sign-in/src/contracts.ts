import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@tortoise/contracts';

/**
 * The plugin's authenticated routes. They take the badge and PIN so that neither ever becomes a
 * command input, which the runtime stores with the command's receipt.
 */
export const stationPaths = {
  /** `{ badge, pin, terminal }` from a terminal's session: `201 { token, session }`. */
  signIn: '/api/v1/station/sign-in',
  /** `{ token }`: ends that operator session. */
  signOut: '/api/v1/station/sign-out',
  /** `{ token, terminal }` from the terminal's session after a reload: `200 { session }`. */
  session: '/api/v1/station/session',
  /** `{ principalId, label, badge, pin }` from an admin: `201 { badge }`. */
  enroll: '/api/v1/station/badges',
} as const;

const id = z.string().regex(/^[a-z0-9-]{1,64}$/);
const label = z
  .string()
  .regex(/^\S(.*\S)?$/)
  .max(80);
const principal = z.string().min(1).max(256);
const timestamp = z.number().int().min(0);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const machineCalled = (what: string) => ({
  exception: `Called by the plugin's ${what}; people sign in at a terminal by scanning their badge.`,
});

export const badgeSchema = z.strictObject({
  id,
  principalId: principal,
  label,
  enrolledBy: principal,
  enrolledAt: timestamp,
  revokedAt: timestamp.optional(),
  lockedUntil: timestamp.optional(),
});
export const operatorSessionSchema = z.strictObject({
  id,
  principalId: principal,
  /** The caller the terminal's screen runs as, and the terminal's name on that caller. */
  terminalPrincipal: principal,
  terminal: id,
  startedAt: timestamp,
  expiresAt: timestamp,
});

export const stationSignInOperations = {
  badgeEnroll: defineCapability({
    id: 'station.badge.enroll',
    kind: 'command',
    description:
      'Enroll a badge for a person, with the digest of the badge value and a hashed PIN. The enrollment route computes both; the badge value and PIN are never stored.',
    input: jsonSchema(
      z.strictObject({
        principalId: principal,
        label,
        badgeDigest: digest,
        pinSalt: z.string().regex(/^[0-9a-f]{32}$/),
        pinHash: digest,
      }),
    ),
    output: jsonSchema(z.strictObject({ badge: badgeSchema })),
    permission: { action: 'enroll', resourceType: 'Badge' },
    ui: {
      exception:
        "Called by the plugin's enrollment route, which hashes the PIN. The badge screen posts to that route.",
    },
    audit: { fields: ['principalId', 'label'] },
  }),
  badgeRevoke: defineCapability({
    id: 'station.badge.revoke',
    kind: 'command',
    description: 'Revoke a badge and end the sessions it opened.',
    input: jsonSchema(z.strictObject({ badgeId: id })),
    output: jsonSchema(z.strictObject({ badge: badgeSchema })),
    permission: { action: 'revoke', resourceType: 'Badge' },
    ui: { binding: 'station-badge-revoke' },
    audit: { fields: ['badgeId'] },
  }),
  badgeList: defineCapability({
    id: 'station.badge.list',
    kind: 'query',
    description: 'List enrolled badges and open operator sessions, without badge values or PINs.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(
      z.strictObject({ badges: z.array(badgeSchema), sessions: z.array(operatorSessionSchema) }),
    ),
    permission: { action: 'read', resourceType: 'Badge' },
    ui: { binding: 'station-badges' },
  }),
  badgeVerifier: defineCapability({
    id: 'station.badge.verifier',
    kind: 'query',
    description:
      'The PIN verifier of the active badge with this digest, for the sign-in route to check a PIN against.',
    input: jsonSchema(z.strictObject({ badgeDigest: digest })),
    output: jsonSchema(
      z.strictObject({
        badge: z
          .strictObject({ id, principalId: principal, pinSalt: z.string(), pinHash: digest })
          .nullable(),
      }),
    ),
    permission: { action: 'verify', resourceType: 'Badge' },
    ui: machineCalled('sign-in route'),
  }),
  sessionStart: defineCapability({
    id: 'station.session.start',
    kind: 'command',
    description:
      'Record a sign-in attempt at a terminal. A verified attempt on an unlocked badge opens an operator session holding the digest of its token and ends the terminal’s previous session; a failed one counts toward the badge’s lockout.',
    input: jsonSchema(
      z.strictObject({
        badgeId: id,
        verified: z.boolean(),
        terminalPrincipal: principal,
        terminal: id,
        tokenDigest: digest,
      }),
    ),
    output: jsonSchema(
      z.strictObject({
        session: operatorSessionSchema.nullable(),
        refusal: z.enum(['pin', 'locked', 'revoked']).optional(),
      }),
    ),
    permission: { action: 'start', resourceType: 'OperatorSession' },
    ui: machineCalled('sign-in route'),
    audit: { fields: ['badgeId', 'verified', 'terminalPrincipal', 'terminal'] },
  }),
  sessionEnd: defineCapability({
    id: 'station.session.end',
    kind: 'command',
    description: 'End the operator session a token digest belongs to.',
    input: jsonSchema(z.strictObject({ tokenDigest: digest })),
    output: jsonSchema(z.strictObject({ ended: z.boolean() })),
    permission: { action: 'end', resourceType: 'OperatorSession' },
    ui: machineCalled('sign-out route'),
    audit: { fields: [] },
  }),
  sessionResolve: defineCapability({
    id: 'station.session.resolve',
    kind: 'query',
    description:
      'Find the open operator session a token digest belongs to. Called by the plugin on every request that presents an operator token.',
    input: jsonSchema(z.strictObject({ tokenDigest: digest })),
    output: jsonSchema(z.strictObject({ session: operatorSessionSchema.nullable() })),
    permission: { action: 'resolve', resourceType: 'OperatorSession' },
    ui: machineCalled('credential check'),
  }),
} as const;

/** Browser-safe module: badges, PIN verifiers and operator sessions. */
export const stationSignInModule = defineModule({
  id: 'station-sign-in',
  capabilities: Object.values(stationSignInOperations),
});
