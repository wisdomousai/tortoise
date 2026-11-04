import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AUDIT_GENESIS, type AuditEvent } from '@tortoise/contracts';
import { hashEvent } from './chain';
import { listSegments } from './jsonl';

export interface VerificationProblem {
  readonly segment: string;
  readonly line: number;
  readonly problem: string;
}
export interface VerificationReport {
  readonly ok: boolean;
  readonly segments: number;
  readonly events: number;
  readonly firstSeq?: number;
  readonly head?: { readonly seq: number; readonly hash: string };
  readonly checkpoints: number;
  readonly problems: readonly VerificationProblem[];
}

export interface VerifyOptions {
  /**
   * Chain head of the last segment removed by retention. Without it the first retained event
   * must be the genesis event; with it the first event must link to this head.
   */
  readonly anchor?: { readonly seq: number; readonly hash: string };
  /**
   * Verify a live log up to a head its writer reported (`JsonlEventLog.head()`). Events after it,
   * including a line still being written, are ignored, and the event at `head.seq` must carry
   * `head.hash`, which ties the files to the writer's in-memory chain.
   */
  readonly head?: { readonly seq: number; readonly hash: string };
}

/**
 * Recompute every hash and link in a JSON-lines log. Detects edited, reordered, inserted, removed
 * or truncated events and checkpoints that disagree with the chain. It cannot detect a log
 * rewritten from scratch by someone holding the files; compare the head with an off-host copy
 * (forwarded events or a recorded checkpoint) for that.
 */
export async function verifyEventLog(
  directory: string,
  options: VerifyOptions = {},
): Promise<VerificationReport> {
  const problems: VerificationProblem[] = [];
  const segments = await listSegments(directory);
  let expected = options.anchor ?? { seq: 0, hash: AUDIT_GENESIS };
  let firstSeq: number | undefined;
  let events = 0;
  let checkpoints = 0;
  const limit = options.head?.seq ?? Number.POSITIVE_INFINITY;
  let lastSegment = '';
  scan: for (const segment of segments) {
    lastSegment = segment;
    const text = await readFile(join(directory, segment), 'utf8');
    const lines = text.split('\n');
    if (text.length && !text.endsWith('\n') && options.head === undefined)
      problems.push({ segment, line: lines.length, problem: 'torn final line' });
    for (let index = 0; index < lines.length; index++) {
      if (expected.seq >= limit) break scan;
      const line = lines[index]!;
      if (!line) continue;
      const at = { segment, line: index + 1 };
      let event: AuditEvent;
      try {
        event = JSON.parse(line) as AuditEvent;
      } catch {
        // With a live head, an unterminated last line is an append in progress, not damage.
        if (options.head && index === lines.length - 1) break;
        problems.push({ ...at, problem: 'unparseable event' });
        continue;
      }
      events++;
      firstSeq ??= event.seq;
      if (event.seq !== expected.seq + 1)
        problems.push({ ...at, problem: `sequence ${event.seq} after ${expected.seq}` });
      if (event.prev !== expected.hash) problems.push({ ...at, problem: 'broken chain link' });
      const { hash, ...unsealed } = event;
      let recomputed = '';
      try {
        recomputed = hashEvent(unsealed);
      } catch {
        problems.push({ ...at, problem: 'event is not canonical JSON' });
      }
      if (recomputed && recomputed !== hash)
        problems.push({ ...at, problem: 'hash mismatch (event altered)' });
      if (event.kind === 'log.checkpoint') {
        checkpoints++;
        const data = event.data as { headSeq?: number; headHash?: string } | undefined;
        if (data?.headSeq !== expected.seq || data?.headHash !== expected.hash)
          problems.push({ ...at, problem: 'checkpoint disagrees with chain' });
      }
      expected = { seq: event.seq, hash };
    }
  }
  if (options.head && expected.seq < options.head.seq)
    problems.push({
      segment: lastSegment,
      line: 0,
      problem: `log ends before head ${options.head.seq}`,
    });
  else if (options.head && expected.hash !== options.head.hash)
    problems.push({
      segment: lastSegment,
      line: 0,
      problem: 'event at head does not match the writer',
    });
  return {
    ok: problems.length === 0,
    segments: segments.length,
    events,
    ...(firstSeq !== undefined ? { firstSeq } : {}),
    ...(events ? { head: expected } : {}),
    checkpoints,
    problems,
  };
}

const commandOutcomes = new Set([
  'command.committed',
  'command.replayed',
  'command.recovered',
  'command.aborted',
  'command.failed',
  'command.denied',
]);
/**
 * `command.accepted` events without a later outcome for the same correlation. The host passes
 * them to the runtime's `recoverAudit` at startup.
 */
export function unresolvedCommands(events: readonly AuditEvent[]): AuditEvent[] {
  const resolved = new Set(
    events
      .filter((event) => commandOutcomes.has(event.kind) && event.correlationId)
      .map((event) => event.correlationId),
  );
  return events.filter(
    (event) =>
      event.kind === 'command.accepted' &&
      event.correlationId !== undefined &&
      !resolved.has(event.correlationId),
  );
}

export interface ReadEventsOptions {
  readonly afterSeq?: number;
  readonly limit?: number;
  readonly kinds?: readonly string[];
}
/** Read events in order for reports and the audit query. Unparseable lines are skipped. */
export async function readEvents(
  directory: string,
  options: ReadEventsOptions = {},
): Promise<AuditEvent[]> {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const result: AuditEvent[] = [];
  for (const segment of await listSegments(directory)) {
    for (const line of (await readFile(join(directory, segment), 'utf8')).split('\n')) {
      if (!line) continue;
      let event: AuditEvent;
      try {
        event = JSON.parse(line) as AuditEvent;
      } catch {
        continue;
      }
      if (event.seq <= (options.afterSeq ?? 0)) continue;
      if (options.kinds && !options.kinds.includes(event.kind)) continue;
      result.push(event);
      if (result.length >= limit) return result;
    }
  }
  return result;
}
