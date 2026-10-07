import { describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuditEvent } from '@agent-native/contracts';
import {
  createMemoryEventLog,
  EventLogLockedError,
  forwardingEventLog,
  listSegments,
  openJsonlEventLog,
  readEvents,
  rfc5424,
  segmentName,
  verifyEventLog,
} from '../src/index';

const source = { component: 'authority', instance: 'test' };
let clock = 1_800_000_000_000;
const now = () => ++clock;
const withDirectory = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), 'event-log-'));
  try {
    await run(join(directory, 'log'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
const record = (n: number) => ({
  kind: 'command.committed',
  outcome: 'committed' as const,
  operation: 'task.create',
  cursor: n,
});

describe('event log chain', () => {
  test('memory log seals consecutive, chained, canonical events', async () => {
    const log = createMemoryEventLog({ now });
    const [first] = await log.append([record(1)]);
    const [second] = await log.append([
      { ...record(2), actor: { principalId: 'p', runId: undefined } },
    ]);
    expect(first!.seq).toBe(1);
    expect(second!.prev).toBe(first!.hash);
    // Undefined members are dropped so the event stays canonical JSON.
    expect('runId' in second!.actor!).toBe(false);
    await expect(log.append([{ kind: 'Bad Kind', outcome: 'info' }])).rejects.toThrow('kind');
    expect(log.events()).toHaveLength(2);
  });

  test('concurrent appends keep sequence and links in call order', async () => {
    const log = createMemoryEventLog({ now });
    await Promise.all(Array.from({ length: 20 }, (_, i) => log.append([record(i)])));
    const events = log.events();
    events.forEach((event, i) => {
      expect(event.seq).toBe(i + 1);
      if (i) expect(event.prev).toBe(events[i - 1]!.hash);
    });
  });
});

describe('JSON-lines event log', () => {
  test('appends durably, resumes the chain after reopen and verifies', async () => {
    await withDirectory(async (directory) => {
      const log = await openJsonlEventLog({ directory, source, now });
      await log.append([record(1), record(2)]);
      await log.close();
      const reopened = await openJsonlEventLog({ directory, source, now });
      await reopened.append([record(3)]);
      await reopened.close();
      const report = await verifyEventLog(directory);
      expect(report.ok).toBe(true);
      // Two log.opened events plus three records.
      expect(report.events).toBe(5);
      expect((await readEvents(directory, { kinds: ['log.opened'] }))[1]!.data).toMatchObject({
        resumedSeq: 3,
      });
      expect((await stat(join(directory, segmentName(1)))).mode & 0o777).toBe(0o600);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    });
  });

  test('rotation continues one chain across segments and checkpoints match the head', async () => {
    await withDirectory(async (directory) => {
      const log = await openJsonlEventLog({
        directory,
        source,
        now,
        segmentBytes: 600,
        checkpointEvery: 4,
      });
      for (let i = 0; i < 12; i++) await log.append([record(i)]);
      await log.close();
      expect((await listSegments(directory)).length).toBeGreaterThan(2);
      const report = await verifyEventLog(directory);
      expect(report.ok).toBe(true);
      expect(report.checkpoints).toBeGreaterThan(1);
    });
  });

  test('an edited, removed or reordered event is detected', async () => {
    await withDirectory(async (directory) => {
      const log = await openJsonlEventLog({ directory, source, now });
      await log.append([record(1), record(2), record(3)]);
      await log.close();
      const path = join(directory, segmentName(1));
      const original = await readFile(path, 'utf8');
      const lines = original.trimEnd().split('\n');

      await writeFile(path, original.replace('"cursor":2', '"cursor":9'));
      expect((await verifyEventLog(directory)).problems.map((p) => p.problem)).toContain(
        'hash mismatch (event altered)',
      );

      await writeFile(path, [lines[0], lines[1], lines[3]].join('\n') + '\n');
      const removed = (await verifyEventLog(directory)).problems.map((p) => p.problem);
      expect(removed).toContain('sequence 4 after 2');
      expect(removed).toContain('broken chain link');

      await writeFile(path, [lines[0], lines[2], lines[1], lines[3]].join('\n') + '\n');
      expect((await verifyEventLog(directory)).ok).toBe(false);

      // A pruned prefix verifies only against the recorded anchor.
      await writeFile(path, lines.slice(2).join('\n') + '\n');
      expect((await verifyEventLog(directory)).ok).toBe(false);
      const anchor = JSON.parse(lines[1]!) as AuditEvent;
      expect((await verifyEventLog(directory, { anchor })).ok).toBe(true);
    });
  });

  test('a torn final line from an unacknowledged append is truncated and recorded on open', async () => {
    await withDirectory(async (directory) => {
      const log = await openJsonlEventLog({ directory, source, now });
      await log.append([record(1)]);
      await log.close();
      await appendFile(join(directory, segmentName(1)), '{"seq":3,"kind":"command.comm');
      expect((await verifyEventLog(directory)).problems[0]?.problem).toBe('torn final line');
      const reopened = await openJsonlEventLog({ directory, source, now });
      await reopened.close();
      const report = await verifyEventLog(directory);
      expect(report.ok).toBe(true);
      const opened = await readEvents(directory, { kinds: ['log.opened'] });
      expect((opened.at(-1)!.data as { truncatedBytes: number }).truncatedBytes).toBeGreaterThan(0);
    });
  });

  test('a rejected batch writes nothing and the next append keeps the chain', async () => {
    await withDirectory(async (directory) => {
      const log = await openJsonlEventLog({ directory, source, now });
      await expect(
        log.append([{ kind: 'command.accepted', outcome: 'accepted', data: { n: Infinity } }]),
      ).rejects.toThrow();
      await log.append([record(1)]);
      await log.close();
      expect((await verifyEventLog(directory)).ok).toBe(true);
    });
  });
});

describe('live verification', () => {
  test('verifies up to the writer head and ignores an append in progress', async () => {
    await withDirectory(async (directory) => {
      const log = await openJsonlEventLog({ directory, source, now });
      await log.append([record(1), record(2)]);
      const head = log.head();
      // A concurrent append that has written only part of its line.
      await appendFile(join(directory, segmentName(1)), '{"seq":');
      expect((await verifyEventLog(directory, { head })).ok).toBe(true);
      expect((await verifyEventLog(directory)).problems[0]?.problem).toBe('torn final line');
      const forged = await verifyEventLog(directory, { head: { ...head, hash: 'f'.repeat(64) } });
      expect(forged.problems.map((problem) => problem.problem)).toEqual([
        'event at head does not match the writer',
      ]);
      await log.close();
    });
  });
});

describe('JSON-lines writer lock', () => {
  test('a second writer is refused until the first closes', async () => {
    await withDirectory(async (directory) => {
      const first = await openJsonlEventLog({ directory, source, now });
      await expect(openJsonlEventLog({ directory, source, now })).rejects.toBeInstanceOf(
        EventLogLockedError,
      );
      await first.close();
      const second = await openJsonlEventLog({ directory, source, now });
      await second.append([record(1)]);
      await second.close();
      expect((await verifyEventLog(directory)).ok).toBe(true);
    });
  });
});

describe('forwarding', () => {
  test('forwards after the local append and counts sink failures without failing callers', async () => {
    const primary = createMemoryEventLog({ now });
    const received: AuditEvent[] = [];
    let fail = false;
    const log = forwardingEventLog(primary, async (events) => {
      if (fail) throw new Error('collector down');
      received.push(...events);
    });
    await log.append([record(1)]);
    await log.flush();
    fail = true;
    await log.append([record(2)]);
    await log.flush();
    expect(received.map((event) => event.seq)).toEqual([1]);
    expect(primary.events()).toHaveLength(2);
    expect(log.stats()).toMatchObject({ forwarded: 1, failures: 1, dropped: 1 });
  });

  test('RFC 5424 output carries priority, sequence and hash', async () => {
    const [event] = await createMemoryEventLog({ now }).append([
      { kind: 'egress.denied', outcome: 'denied', reason: 'UNDECLARED' },
    ]);
    const line = rfc5424(event!, { appName: 'workspace', hostname: 'station-1' });
    expect(line.startsWith('<108>1 ')).toBe(true);
    expect(line).toContain(`seq="1" kind="egress.denied" hash="${event!.hash}"`);
  });
});
