import { z } from 'zod';
import { defineCapability, defineModule } from './capability';
import { defineFeatureManifest } from './feature';
import { collectionGet, collectionList, defineCollection, recordKeySchema } from './collection';
import { jsonSchema, jsonValueSchema } from './schema';

export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired']);
export type ApprovalStatus = z.output<typeof approvalStatusSchema>;

const revisionsSchema = z.record(z.string().min(1).max(256), z.number().int().min(0));

/**
 * One requested command. `operation`, `input`, `rationale`, `confidence`, `model`, `resource`
 * and `baseRevisions` are what the requester stated; `requestedBy`, `runId` and the times come
 * from the trusted context and clock. `model` is reported by the requester, not verified.
 */
export const approvalRequestSchema = z.strictObject({
  id: recordKeySchema,
  operation: z.string().min(1).max(128),
  input: z.record(z.string(), jsonValueSchema),
  rationale: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1).optional(),
  model: z.string().min(1).max(200).optional(),
  /** The record the approval request is about, for example `stop:42`; screens show it there. */
  resource: z.string().min(1).max(256).optional(),
  /** Revisions the requester read; approving checks them as `expectedRevisions`. */
  baseRevisions: revisionsSchema,
  status: approvalStatusSchema,
  requestedBy: z.string().min(1),
  runId: z.string().min(1).optional(),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  closedBy: z.string().min(1).optional(),
  closedAt: z.number().int().optional(),
  /** Why it was rejected or expired. */
  reason: z.string().min(1).max(2000).optional(),
});
export type ApprovalRequest = z.output<typeof approvalRequestSchema>;

/** The approval requests collection: records `approval-request:<id>` in the module's
 * `approvals` slice. */
export const approvals = defineCollection({
  type: 'approval-request',
  resourceType: 'ApprovalRequest',
  item: approvalRequestSchema,
  label: { one: 'Approval request', many: 'Approval requests' },
});

const idInput = z.strictObject({ id: recordKeySchema });
const closed = (status: ApprovalStatus) =>
  z.strictObject({ id: recordKeySchema, status: z.literal(status) });

/**
 * Operations of the approval request module, under fixed IDs. A requester (usually an agent run whose
 * definition has output `request-approval`) submits the command it would run; a person or another allowed
 * caller approves it, which runs that command with the approver's own grants and policy in the
 * same transaction (`continueWith`), or rejects it. The application's policy gives each its rule;
 * approving also passes the requested command's own rule. Browser-safe.
 */
export const approvalOperations = {
  approvalRequest: defineCapability({
    id: 'approval.request',
    kind: 'command',
    description:
      'Request approval for one command: the operation, its complete input, why, and the revisions of the records you read. Nothing changes until a person approves it. A request for an unknown command, an input its schema refuses or an approval operation itself is refused.',
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
            'Optional. Each resource ID you were given a revision for (for example `lot:l1`, as the prompt that started the run names it), mapped to that revision. Approving is refused as a conflict when one changed since. Omit it when you were given no revision.',
          ),
      }),
    ),
    output: jsonSchema(approvalRequestSchema),
    permission: { action: 'request', resourceType: 'ApprovalRequest' },
    dependencies: ['approval-request'],
    ui: { exception: 'agents request approval; people act on the command directly' },
  }),
  approvalApprove: defineCapability({
    id: 'approval.approve',
    kind: 'command',
    description:
      'Approve a pending approval request: run its command with its input as yourself, checked against the revisions the requester read. Refused when you may not run that command, and a conflict when a record changed since; both leave the request pending.',
    input: jsonSchema(idInput),
    output: jsonSchema(
      z.strictObject({ id: recordKeySchema, status: z.literal('approved'), operation: z.string() }),
    ),
    permission: { action: 'approve', resourceType: 'ApprovalRequest' },
    dependencies: ['approval-request'],
    // It continues with whichever command the request names.
    invokes: 'any',
    ui: { binding: 'approval.approve' },
  }),
  approvalReject: defineCapability({
    id: 'approval.reject',
    kind: 'command',
    description:
      'Reject a pending approval request, optionally saying why. Its command never runs.',
    input: jsonSchema(
      z.strictObject({ id: recordKeySchema, reason: z.string().min(1).max(2000).optional() }),
    ),
    output: jsonSchema(closed('rejected')),
    permission: { action: 'approve', resourceType: 'ApprovalRequest' },
    dependencies: ['approval-request'],
    ui: { binding: 'approval.reject' },
  }),
  approvalExpire: defineCapability({
    id: 'approval.expire',
    kind: 'command',
    description:
      'Close a pending approval request whose expiry has passed. One that has not expired yet conflicts.',
    input: jsonSchema(idInput),
    output: jsonSchema(closed('expired')),
    permission: { action: 'expire', resourceType: 'ApprovalRequest' },
    dependencies: ['approval-request'],
    ui: { exception: 'run by a job or agent; people reject instead' },
  }),
  approvalList: collectionList(approvals, {
    id: 'approval',
    description:
      'Approval requests you may see, newest first, filtered by status, operation or the record they are about.',
    filters: ['status', 'operation', 'resource'],
  }),
  approvalGet: collectionGet(approvals, {
    id: 'approval',
    description: 'One approval request you may see, or NOT_FOUND.',
    ui: { exception: 'screens show approval requests from the list; agents read one' },
  }),
} as const;

/** The approval request feature's module: every approval operation under the `approval` id. */
export const approvalModule = defineModule({
  id: 'approval',
  capabilities: Object.values(approvalOperations),
});

/**
 * The browser-safe part of the approval request feature. An application lists it in
 * `defineManifest({ features })` and mounts the server part, `approvalFeature`, once.
 */
export const approvalFeatureManifest = defineFeatureManifest({
  id: 'approval',
  title: 'Approval requests',
  modules: [approvalModule],
});
