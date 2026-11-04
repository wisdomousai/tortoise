import { z } from 'zod';

export const externalId = z.string().min(1).max(64);
export const timestamp = z.number().int().nonnegative();
export const region = z.string().min(1).max(32);
/** What this application holds of a CRM record: nothing yet, a follow in flight, a copy, or a refusal. */
export const localStatus = z.enum(['none', 'requested', 'following', 'rejected']);
export const syncStatus = z.enum(['pending', 'accepted', 'rejected']);
const rejection = z.strictObject({ code: z.string(), message: z.string() });

/** One CRM account as a search returns it, with what this workspace holds of it. */
export const accountFoundSchema = z.strictObject({
  externalId: z.string(),
  name: z.string(),
  industry: z.string(),
  city: z.string(),
  region,
  owner: z.string(),
  local: localStatus,
});
/** One CRM contact as a search returns it. Following a contact means following its account. */
export const contactFoundSchema = z.strictObject({
  externalId: z.string(),
  name: z.string(),
  title: z.string(),
  email: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  region,
  local: localStatus,
});

export const searchInput = z.strictObject({
  q: z.string().max(100),
  limit: z.number().int().min(1).max(50).optional(),
});

/** A followed account: the copy the CRM inbound sync keeps current, and how it got here. */
export const accountSchema = z.strictObject({
  id: externalId,
  status: localStatus.exclude(['none']),
  name: z.string().optional(),
  industry: z.string().optional(),
  city: z.string().optional(),
  region: region.optional(),
  owner: z.string().optional(),
  followedBy: z.string(),
  followedAt: timestamp,
  syncedAt: timestamp.optional(),
  rejection: rejection.optional(),
  activities: z.number().int(),
});
export const activitySchema = z.strictObject({
  id: z.string(),
  accountId: externalId,
  kind: z.enum(['call', 'meeting', 'note']),
  summary: z.string(),
  occurredAt: timestamp,
  recordedBy: z.string(),
  sync: syncStatus,
  sorRef: z.string().optional(),
  rejection: rejection.optional(),
});
export const accountDetailSchema = z.strictObject({
  ...accountSchema.shape,
  history: z.array(activitySchema),
});
/** An account snapshot the CRM inbound sync delivers for a followed account. */
export const accountSnapshotSchema = z.strictObject({
  externalId,
  name: z.string().max(200),
  industry: z.string().max(100),
  city: z.string().max(100),
  region,
  owner: z.string().max(100),
});
