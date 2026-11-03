import { z } from 'zod';
import { defineCapability, jsonSchema } from '@agent-native/contracts';

/** The workspace roles: desk members change records, supervisors also approve, viewers read. */
export const roleSchema = z.enum(['desk', 'supervisor', 'viewer']);

/**
 * The caller's own role. Members. The browser holds no role of its own, so a screen reads it here
 * to show what the person may decide, such as Approve and Reject on an approval request. The
 * policy still decides every command.
 */
export const memberCurrent = defineCapability({
  id: 'member.current',
  kind: 'query',
  description:
    "Read the caller's own role in this workspace: desk, supervisor or viewer. Screens call it to show what the person may decide, such as Approve and Reject for a supervisor. Returns the caller's principal ID and role, and nothing about other members. Any member may call it.",
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(
    z.strictObject({
      principalId: z.string().min(1).describe('The principal ID of the caller.'),
      role: roleSchema.describe(
        "The caller's role: desk changes records, supervisor also approves discounts above 10 percent, viewer reads.",
      ),
    }),
  ),
  permission: { action: 'read', resourceType: 'Member' },
  ui: { binding: 'member.current' },
  display: { label: 'Your role' },
});
