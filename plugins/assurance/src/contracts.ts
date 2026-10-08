import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';

/**
 * Browser-safe capability module through which authorized auditors read the running posture and
 * the audit log. Queries only: nothing here changes configuration, and the log itself is
 * append-only. Every call is authorized like any other operation (permission `read` on
 * `Audit`) and is itself audited, so reading the audit trail leaves a trace.
 */
const auditRead = { action: 'read', resourceType: 'Audit' } as const;
const count = z.number().int().min(0);
const digest = z.string().regex(/^[0-9a-f]{64}$|^unavailable$/);

export const postureCheckSchema = z.strictObject({
  id: z.string(),
  status: z.enum(['pass', 'info', 'warn', 'fail']),
  summary: z.string(),
});
export const destinationPostureSchema = z.strictObject({
  id: z.string(),
  owner: z.string(),
  direction: z.enum(['egress', 'ingress']),
  scope: z.enum(['loopback', 'site', 'internet']),
  availability: z.enum(['required', 'optional']),
  state: z.enum(['bound', 'disabled', 'unbound', 'isolated', 'local']),
  /** Bound origin, without credentials or path. */
  origin: z.string().optional(),
  offline: z.enum(['queue', 'degrade', 'unavailable']).optional(),
  allowed: count,
  denied: count,
  lastUsedAt: z.number().int().optional(),
});
export const postureSchema = z.strictObject({
  checkedAt: z.number().int(),
  status: z.enum(['ok', 'attention', 'failing']),
  profile: z.enum(['desktop-local', 'sandbox', 'zero-trust']),
  networkMode: z.enum(['isolated', 'connected']),
  auditMode: z.enum(['fail-closed', 'best-effort']),
  policyDigest: digest,
  catalogDigest: digest.optional(),
  executableDigest: digest.optional(),
  checks: z.array(postureCheckSchema),
  destinations: z.array(destinationPostureSchema),
  findings: z.array(
    z.strictObject({
      level: z.enum(['error', 'warning', 'info']),
      code: z.string(),
      destination: z.string().optional(),
    }),
  ),
  log: z.strictObject({
    headSeq: count,
    verified: z.boolean(),
    problems: count,
    checkpoints: count,
  }),
  forwarding: z
    .strictObject({
      destination: z.string(),
      forwarded: count,
      dropped: count,
      failures: count,
      pending: count,
    })
    .optional(),
});

// Event data as bounded JSON: two levels of nesting, deeper values serialized to a JSON string
// by `boundedEventData`. Recorded data is small and flat in practice; the bound keeps the
// published schema finite.
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const nested = z.union([scalar, z.array(scalar), z.record(z.string(), scalar)]);
const eventValue = z.union([
  scalar,
  z.array(z.union([scalar, z.record(z.string(), scalar)])),
  z.record(z.string(), nested),
]);
const outcome = z.enum([
  'accepted',
  'committed',
  'recovered',
  'aborted',
  'denied',
  'failed',
  'allowed',
  'completed',
  'info',
]);
export const auditEventSchema = z.strictObject({
  seq: z.number().int().min(1),
  at: z.number().int(),
  kind: z.string(),
  outcome,
  source: z.strictObject({ component: z.string(), instance: z.string() }),
  actor: z
    .strictObject({
      principalId: z.string(),
      workspaceId: z.string().optional(),
      runId: z.string().optional(),
      via: z.string().optional(),
    })
    .optional(),
  operation: z.string().optional(),
  resources: z.array(z.string()).optional(),
  reason: z.string().optional(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  cursor: z.number().int().optional(),
  inputDigest: z.string().optional(),
  data: z.record(z.string(), eventValue).optional(),
  prev: z.string(),
  hash: z.string(),
});
export const verificationSchema = z.strictObject({
  ok: z.boolean(),
  segments: count,
  events: count,
  checkpoints: count,
  headSeq: count,
  problems: z.array(z.strictObject({ segment: z.string(), line: count, problem: z.string() })),
});

export const assuranceOperations = {
  postureGet: defineCapability({
    id: 'assurance.posture.get',
    kind: 'query',
    description:
      'Read the current security posture: hardening profile, network mode, every declared destination with whether it is bound, disabled or isolated and how often it was used or denied, policy findings, audit-chain integrity and audit forwarding health. Use it to answer what this installation can reach and whether its audit trail is intact.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(postureSchema),
    permission: auditRead,
    dependencies: ['audit'],
    ui: { binding: 'security-posture' },
  }),
  eventsList: defineCapability({
    id: 'assurance.events.list',
    kind: 'query',
    description:
      'Page through the audit log in sequence order. Filter by event kinds (for example egress.denied or command.denied) and outcome; pass the returned nextAfterSeq to continue. Inputs appear only as digests unless a capability allow-lists a field.',
    input: jsonSchema(
      z.strictObject({
        afterSeq: count.optional(),
        limit: z.number().int().min(1).max(200).optional(),
        kinds: z.array(z.string().min(1).max(64)).max(20).optional(),
        outcome: outcome.optional(),
        /** Return the most recent matching events (still in sequence order) instead of paging. */
        newest: z.boolean().optional(),
      }),
    ),
    output: jsonSchema(
      z.strictObject({
        items: z.array(auditEventSchema),
        nextAfterSeq: count,
        headSeq: count,
      }),
    ),
    permission: auditRead,
    dependencies: ['audit'],
    ui: { binding: 'security-posture' },
  }),
  logVerify: defineCapability({
    id: 'assurance.log.verify',
    kind: 'query',
    description:
      'Recompute the audit log hash chain up to the current head and report any edited, removed, reordered or truncated events. A clean result proves internal consistency; compare the head with an off-host copy to rule out a full rewrite.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(verificationSchema),
    permission: auditRead,
    dependencies: ['audit'],
    ui: { binding: 'security-posture' },
  }),
} as const;

export const assuranceModule = defineModule({
  id: 'assurance',
  capabilities: Object.values(assuranceOperations),
  workflows: [
    {
      id: 'review-security-posture',
      operations: ['assurance.posture.get', 'assurance.events.list', 'assurance.log.verify'],
      text: 'Start with the posture. For any check that is not passing, list the matching audit events (for example kinds egress.denied, command.denied or posture.checked) and verify the chain before drawing conclusions. Report destinations by ID and state; never infer that an unbound destination was reached.',
    },
  ],
});

export type Posture = z.infer<typeof postureSchema>;
export type PostureCheck = z.infer<typeof postureCheckSchema>;
export type DestinationPosture = z.infer<typeof destinationPostureSchema>;
export type AuditEventView = z.infer<typeof auditEventSchema>;
export type LogVerification = z.infer<typeof verificationSchema>;
