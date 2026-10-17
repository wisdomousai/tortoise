import { z } from 'zod';
import { defineCapability } from './capability';
import { jsonSchema, jsonValueSchema } from './schema';

/**
 * A held outbox effect as a person sees it to reconcile: the target may or may not have applied
 * it, so it waits for a decision instead of a retry. `payload` is what was sent, so the person
 * can check the target for it.
 */
export const heldEffectSchema = z.strictObject({
  id: z.string().min(1).max(256),
  target: z.string().min(1).max(128),
  type: z.string().min(1).max(128),
  resource: z.string().min(1).max(256),
  operation: z.string().min(1).max(128),
  principalId: z.string().min(1),
  payload: jsonValueSchema,
  createdAt: z.number().int(),
  heldAt: z.number().int(),
  holdReason: z.string().max(500).optional(),
  attempts: z.number().int().min(0),
  contractVersion: z.string().optional(),
});
export type HeldEffect = z.output<typeof heldEffectSchema>;

/**
 * `applied`: the target did it, so the effect settles as accepted. `not-applied`: it did not,
 * so the effect is released and delivered again. `refused`: the target will not do it, so the
 * effect settles as rejected.
 */
export const reconciliationDecisionSchema = z.enum(['applied', 'not-applied', 'refused']);
export type ReconciliationDecision = z.output<typeof reconciliationDecisionSchema>;

/**
 * Operations of the reconciliation module, under fixed IDs: held effects across every target,
 * and the decision a person makes for one. The application's policy gives each its rule, and
 * its `visible` rule (see the runtime's `reconciliationHandlers`) decides which effects a caller
 * sees and may decide. Browser-safe.
 */
export const reconciliationOperations = {
  reconciliationList: defineCapability({
    id: 'reconciliation.list',
    kind: 'query',
    description:
      'Held outbox effects you may see, oldest first, optionally for one target or record: deliveries whose outcome nobody could establish, waiting for a person to say whether the target applied them.',
    input: jsonSchema(
      z.strictObject({
        target: z.string().min(1).max(128).optional(),
        resource: z.string().min(1).max(256).optional(),
      }),
    ),
    output: jsonSchema(z.strictObject({ items: z.array(heldEffectSchema) })),
    permission: { action: 'read', resourceType: 'Reconciliation' },
    ui: { binding: 'reconciliation.list' },
  }),
  reconciliationResolve: defineCapability({
    id: 'reconciliation.resolve',
    kind: 'command',
    description:
      'Decide a held effect after checking the target: applied settles it as accepted (with the reference you found there, if any), not-applied delivers it again, refused settles it as rejected with your reason.',
    input: jsonSchema(
      z.strictObject({
        effectId: z.string().min(1).max(256),
        decision: reconciliationDecisionSchema,
        /** For `applied`: the target's own reference for the record, if the person found one. */
        externalRef: z.string().min(1).max(256).optional(),
        /** For `refused`: why the target will not do it. */
        reason: z.string().min(1).max(500).optional(),
      }),
    ),
    output: jsonSchema(
      z.strictObject({
        effectId: z.string(),
        status: z.enum(['accepted', 'rejected', 'pending']),
      }),
    ),
    permission: { action: 'reconcile', resourceType: 'Reconciliation' },
    ui: { binding: 'reconciliation.resolve' },
  }),
} as const;
