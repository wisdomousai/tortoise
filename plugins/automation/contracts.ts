import { z } from 'zod';
import { defineCapability, defineModule, jsonSchema } from '@agent-native/contracts';

const id = z.string().min(1).max(256);
const time = z.number().int();
const DAY = 24 * 60 * 60 * 1000;
/** The longest a standing grant runs before it must be renewed. */
export const MAX_GRANT_MS = 90 * DAY;

/**
 * What starts a trigger. `event`: a committed change to a resource of `resourceType` by one of
 * `operations`, read from the journal as the grant's issuer, so the issuer must be able to see
 * it; an attention item is an event like any other. `schedule`: once per `everyMs` slot.
 */
export type TriggerSource =
  | {
      readonly event: {
        readonly resourceType: string;
        /** Operations whose changes start a run; the journal is read narrowed to them. */
        readonly operations: readonly string[];
        /** Journal event types to react to, for example `created`; every type when omitted. */
        readonly types?: readonly string[];
      };
    }
  | { readonly schedule: { readonly everyMs: number } };

/**
 * A trigger the application declares. It runs one agent definition or one deterministic job
 * the server plugin registers. A trigger does nothing until a person issues a standing grant
 * for it; every run then acts as that person, narrowed to the trigger's operations.
 */
export interface TriggerDefinition {
  readonly id: string;
  readonly title: string;
  readonly on: TriggerSource;
  readonly run:
    { readonly agent: string } | { readonly job: string; readonly operations: readonly string[] };
  /** For an agent run: the task, followed by the event that started it. */
  readonly prompt?: string;
  /** For a job run; an agent run uses its definition's budgets. */
  readonly budgets?: { readonly toolCalls: number; readonly wallTimeMs: number };
}

/** Declare a trigger. Checked against the catalog and the registered jobs when the plugin opens. */
export const defineTrigger = <const T extends TriggerDefinition>(trigger: T): T =>
  Object.freeze(trigger);

export const standingGrantSchema = z.strictObject({
  id,
  trigger: id,
  /** The person whose instance every run of this grant uses. */
  issuedBy: id,
  operations: z.array(z.string()),
  issuedAt: time,
  expiresAt: time,
  revokedAt: time.optional(),
  revokedBy: id.optional(),
});

export const triggerSummarySchema = z.strictObject({
  id,
  title: z.string(),
  on: z.enum(['event', 'schedule']),
  runs: z.enum(['agent', 'job']),
  /** The active grant: unrevoked and unexpired. */
  grant: standingGrantSchema.optional(),
  /** Journal cursor or schedule slot the active grant's runs have reached. */
  cursor: z.number().int().min(0).optional(),
  slot: z.number().int().min(0).optional(),
  lastRunAt: time.optional(),
  lastOutcome: z.enum(['succeeded', 'failed']).optional(),
  openFailures: z.number().int().min(0),
});

export const failureSchema = z.strictObject({
  id,
  trigger: id,
  grant: id,
  runId: id,
  code: z.string().max(64),
  message: z.string().max(500),
  at: time,
  resolvedAt: time.optional(),
  resolvedBy: id.optional(),
});

const grantInput = z.strictObject({ id });
const lifetime = z.number().int().min(60_000).max(MAX_GRANT_MS);

export const automationOperations = {
  triggerList: defineCapability({
    id: 'automation.trigger.list',
    kind: 'query',
    description:
      'List the triggers the application declares, each with its active standing grant (who issued it and until when), its last run and its open failures.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ items: z.array(triggerSummarySchema) })),
    permission: { action: 'read', resourceType: 'Trigger' },
    ui: { binding: 'automation.triggers' },
  }),
  grantIssue: defineCapability({
    id: 'automation.grant.issue',
    kind: 'command',
    description:
      "Enable a trigger by issuing a standing grant as yourself for `expiresInMs` (at most 90 days). Its runs act as you, narrowed to the trigger's operations, and are refused whatever you could not do yourself. Replaces any earlier grant for the trigger, so the trigger then runs as you. People only.",
    input: jsonSchema(z.strictObject({ trigger: id, expiresInMs: lifetime })),
    output: jsonSchema(standingGrantSchema),
    permission: { action: 'issue', resourceType: 'StandingGrant' },
    ui: { binding: 'automation.triggers' },
    audit: { fields: ['trigger', 'expiresInMs'] },
  }),
  grantRenew: defineCapability({
    id: 'automation.grant.renew',
    kind: 'command',
    description:
      'Extend a standing grant you issued to `expiresInMs` from now. A revoked grant cannot be renewed. People only.',
    input: jsonSchema(z.strictObject({ id, expiresInMs: lifetime })),
    output: jsonSchema(standingGrantSchema),
    permission: { action: 'issue', resourceType: 'StandingGrant' },
    ui: { binding: 'automation.triggers' },
    audit: { fields: ['id', 'expiresInMs'] },
  }),
  grantRevoke: defineCapability({
    id: 'automation.grant.revoke',
    kind: 'command',
    description: 'Revoke a standing grant you issued. No run starts under it again. People only.',
    input: jsonSchema(grantInput),
    output: jsonSchema(standingGrantSchema),
    permission: { action: 'issue', resourceType: 'StandingGrant' },
    ui: { binding: 'automation.triggers' },
    audit: { fields: ['id'] },
  }),
  progressRecord: defineCapability({
    id: 'automation.progress.record',
    kind: 'command',
    description:
      "Record a trigger's progress under one grant: the journal cursor or schedule slot reached and, when a run finished, its outcome. A failed run becomes an open failure. Called only by the trigger loop.",
    input: jsonSchema(
      z.strictObject({
        grant: id,
        cursor: z.number().int().min(0).optional(),
        slot: z.number().int().min(0).optional(),
        run: z
          .strictObject({
            id,
            outcome: z.enum(['succeeded', 'failed']),
            code: z.string().max(64).optional(),
            message: z.string().max(500).optional(),
          })
          .optional(),
      }),
    ),
    output: jsonSchema(z.strictObject({ grant: id })),
    permission: { action: 'record', resourceType: 'StandingGrant' },
    ui: {
      exception:
        'Written only by the trigger loop as the grant issuer; people see the result in automation.trigger.list and automation.failure.list.',
    },
    audit: { fields: ['grant', 'cursor', 'slot', 'run'] },
  }),
  failureList: defineCapability({
    id: 'automation.failure.list',
    kind: 'query',
    description:
      'Failed trigger runs under grants you issued, open ones first. A failed run is never retried; resolve it after acting on it yourself.',
    input: jsonSchema(z.strictObject({ open: z.boolean().optional() })),
    output: jsonSchema(z.strictObject({ items: z.array(failureSchema) })),
    permission: { action: 'read', resourceType: 'Trigger' },
    ui: { binding: 'automation.failures' },
  }),
  failureResolve: defineCapability({
    id: 'automation.failure.resolve',
    kind: 'command',
    description: 'Mark a failed trigger run under a grant you issued as handled. People only.',
    input: jsonSchema(grantInput),
    output: jsonSchema(failureSchema),
    permission: { action: 'resolve', resourceType: 'Trigger' },
    ui: { binding: 'automation.failures' },
  }),
} as const;

/** Browser-safe module of the automation plugin. */
export const automationModule = defineModule({
  id: 'automation',
  capabilities: Object.values(automationOperations),
});
