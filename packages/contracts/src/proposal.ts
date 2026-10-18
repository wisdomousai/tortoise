import { z } from 'zod';
import { defineCapability } from './capability';
import { collectionGet, collectionList, defineCollection, recordKeySchema } from './collection';
import { jsonSchema, jsonValueSchema } from './schema';

export const proposalStatusSchema = z.enum(['open', 'accepted', 'rejected', 'expired']);
export type ProposalStatus = z.output<typeof proposalStatusSchema>;

const revisionsSchema = z.record(z.string().min(1).max(256), z.number().int().min(0));

/**
 * One proposed command. `operation`, `input`, `rationale`, `confidence`, `model`, `resource`
 * and `baseRevisions` are what the proposer stated; `proposedBy`, `runId` and the times come
 * from the trusted context and clock. `model` is reported by the proposer, not verified.
 */
export const proposalSchema = z.strictObject({
  id: recordKeySchema,
  operation: z.string().min(1).max(128),
  input: z.record(z.string(), jsonValueSchema),
  rationale: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1).optional(),
  model: z.string().min(1).max(200).optional(),
  /** The record the proposal is about, for example `stop:42`; screens show it there. */
  resource: z.string().min(1).max(256).optional(),
  /** Revisions the proposer read; accepting checks them as `expectedRevisions`. */
  baseRevisions: revisionsSchema,
  status: proposalStatusSchema,
  proposedBy: z.string().min(1),
  runId: z.string().min(1).optional(),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  closedBy: z.string().min(1).optional(),
  closedAt: z.number().int().optional(),
  /** Why it was rejected or expired. */
  reason: z.string().min(1).max(2000).optional(),
});
export type Proposal = z.output<typeof proposalSchema>;

/** The proposals collection: records `proposal:<id>` in the module's `proposals` slice. */
export const proposals = defineCollection({
  type: 'proposal',
  resourceType: 'Proposal',
  item: proposalSchema,
  label: { one: 'Proposal', many: 'Proposals' },
});

const idInput = z.strictObject({ id: recordKeySchema });
const closed = (status: ProposalStatus) =>
  z.strictObject({ id: recordKeySchema, status: z.literal(status) });

/**
 * Operations of the proposal module, under fixed IDs. A proposer (usually an agent run whose
 * definition has output `propose`) submits the command it would run; a person or another allowed
 * caller accepts it, which runs that command with the accepter's own grants and policy in the same
 * transaction (`continueWith`), or rejects it. The application's policy gives each its rule;
 * accepting also passes the proposed command's own rule. Browser-safe.
 */
export const proposalOperations = {
  proposalSubmit: defineCapability({
    id: 'proposal.submit',
    kind: 'command',
    description:
      'Propose one command for a person to accept: the operation, its complete input, why, and the revisions of the records you read. Nothing changes until it is accepted. A proposal for an unknown command, an input its schema refuses or a proposal itself is refused.',
    input: jsonSchema(
      z.strictObject({
        operation: z.string().min(1).max(128),
        input: z.record(z.string(), jsonValueSchema),
        rationale: z.string().min(1).max(4000),
        confidence: z.number().min(0).max(1).optional(),
        model: z.string().min(1).max(200).optional(),
        resource: z.string().min(1).max(256).optional(),
        baseRevisions: revisionsSchema
          .optional()
          .describe(
            'Optional. Each resource ID you were given a revision for (for example `lot:l1`, as the prompt that started the run names it), mapped to that revision. Accepting is refused as a conflict when one changed since. Omit it when you were given no revision.',
          ),
      }),
    ),
    output: jsonSchema(proposalSchema),
    permission: { action: 'propose', resourceType: 'Proposal' },
    dependencies: ['proposal'],
    ui: { exception: 'agents submit proposals; people act on the command directly' },
  }),
  proposalAccept: defineCapability({
    id: 'proposal.accept',
    kind: 'command',
    description:
      'Accept an open proposal: run its command with its input as yourself, checked against the revisions the proposer read. Refused when you may not run that command, and a conflict when a record changed since; both leave the proposal open.',
    input: jsonSchema(idInput),
    output: jsonSchema(
      z.strictObject({ id: recordKeySchema, status: z.literal('accepted'), operation: z.string() }),
    ),
    permission: { action: 'accept', resourceType: 'Proposal' },
    dependencies: ['proposal'],
    ui: { binding: 'proposal.accept' },
  }),
  proposalReject: defineCapability({
    id: 'proposal.reject',
    kind: 'command',
    description: 'Reject an open proposal, optionally saying why. Its command never runs.',
    input: jsonSchema(
      z.strictObject({ id: recordKeySchema, reason: z.string().min(1).max(2000).optional() }),
    ),
    output: jsonSchema(closed('rejected')),
    permission: { action: 'accept', resourceType: 'Proposal' },
    dependencies: ['proposal'],
    ui: { binding: 'proposal.reject' },
  }),
  proposalExpire: defineCapability({
    id: 'proposal.expire',
    kind: 'command',
    description:
      'Close an open proposal whose expiry has passed. A proposal that has not expired yet conflicts.',
    input: jsonSchema(idInput),
    output: jsonSchema(closed('expired')),
    permission: { action: 'expire', resourceType: 'Proposal' },
    dependencies: ['proposal'],
    ui: { exception: 'run by a job or agent; people reject instead' },
  }),
  proposalList: collectionList(proposals, {
    id: 'proposal',
    description:
      'Proposals you may see, newest first, filtered by status, operation or the record they are about.',
    filters: ['status', 'operation', 'resource'],
  }),
  proposalGet: collectionGet(proposals, {
    id: 'proposal',
    description: 'One proposal you may see, or NOT_FOUND.',
    ui: { exception: 'screens show proposals from the list; one proposal is read by agents' },
  }),
} as const;
