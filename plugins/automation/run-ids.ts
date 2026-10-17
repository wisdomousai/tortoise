/**
 * Run IDs of trigger runs. Each names its grant and the event cursor or schedule slot, so a run
 * repeated after a restart has the same ID and its commands the same idempotency keys.
 */
export const runPrefix = (grant: string) => `auto:${grant}:`;
export const eventRunId = (grant: string, cursor: number) => `${runPrefix(grant)}event:${cursor}`;
export const slotRunId = (grant: string, slot: number) => `${runPrefix(grant)}slot:${slot}`;
/** The loop's own context for recording progress outside a run. */
export const loopRunId = (grant: string) => `${runPrefix(grant)}loop`;
