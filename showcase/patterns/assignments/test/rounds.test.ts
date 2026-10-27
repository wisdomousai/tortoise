import { afterEach, expect, test } from 'bun:test';
import { olga, refused, startTestRequestsAssignments, vera } from './fixtures';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

const gas = 'IEC 60567 dissolved gas analysis';
const water = 'IEC 60814 water content';

test('a member reports the samples of a round sent to them, and a technician accepts each into a test request', async () => {
  const pattern = await startTestRequestsAssignments();
  close = pattern.close;
  const { run, read } = pattern;
  await run('test-request.submit', {
    sample: 'OS-24-0301',
    transformer: 'TR-40517',
    description: 'Annual sample.',
    method: gas,
  });

  // Planning is for technicians, and a round names each transformer once.
  const round = {
    title: 'Northfield, week 17',
    scope: { substation: 'Northfield 110 kV', transformers: ['TR-40517', 'TR-40522'] },
  };
  expect(await refused(run('assignment.sampling.create', round, vera))).toBe('FORBIDDEN');
  expect(
    await refused(
      run('assignment.sampling.create', {
        ...round,
        scope: { ...round.scope, transformers: ['TR-40517', 'TR-40517'] },
      }),
    ),
  ).toBe('INVALID_INPUT');
  const sent = await run('assignment.sampling.create', {
    ...round,
    assignee: { type: 'person', id: 'vera' },
  });
  expect(sent).toMatchObject({ status: 'sent', stage: 'sent' });

  // Vera sees each transformer's last sample as it was when the round was sent.
  expect(await read('assignment.feed', {}, vera)).toMatchObject({
    items: [
      {
        id: sent.id,
        kind: 'sampling',
        brief: {
          substation: 'Northfield 110 kV',
          transformers: [
            { transformer: 'TR-40517', lastSample: 'OS-24-0301', lastMethod: gas },
            { transformer: 'TR-40522', lastSample: '', lastMethod: '' },
          ],
        },
      },
    ],
  });
  expect(await refused(read('assignment.feed', {}, olga))).toBe('FORBIDDEN');

  const report = (id: string, sample: string, description: string, subject?: string) =>
    run(
      'assignment.sampling.report',
      { id, assignmentId: sent.id, ...(subject ? { subject } : {}), body: { sample, description } },
      vera,
    );
  await report('r1', 'OS-24-0417', 'Buchholz relay alarmed last week; gas analysis.', 'TR-40517');
  await report('r2', 'OS-24-0418', 'Breakdown voltage. Oil looks dark.', 'TR-40522');
  await report('r3', 'OS-24-0419', 'Second bottle for water content; breather gel is pink.');
  // A report is about a transformer of the round; another one is refused.
  expect(await refused(report('r4', 'OS-24-0420', 'Wrong bay.', 'TR-99999'))).toBe('INVALID_INPUT');
  await run('assignment.complete', { id: sent.id }, vera);
  // A report that arrives after the done mark, such as a retried delivery, is still taken.
  await report('r5', 'OS-24-0418', 'Same bottle reported again.', 'TR-40522');

  // Accepting needs a technician, and submits the test request as that technician.
  expect(await refused(run('assignment.sampling.accept', { id: 'r1' }, vera))).toBe('FORBIDDEN');
  await run('assignment.sampling.accept', { id: 'r1', method: gas });
  await run('assignment.sampling.accept', { id: 'r2' });
  // An unlinked report is linked to a transformer first.
  expect(await refused(run('assignment.sampling.accept', { id: 'r3' }))).toBe('CONFLICT');
  await run('assignment.report.link', { id: 'r3', subject: 'TR-40522' });
  await run('assignment.sampling.accept', { id: 'r3', method: water });
  // A sample number gets one test request.
  expect(await refused(run('assignment.sampling.accept', { id: 'r5' }))).toBe('CONFLICT');
  await run('assignment.report.discard', { id: 'r5', reason: 'Same bottle as r2.' });

  const requests = (await read('test-request.list', { search: 'OS-24-04' })).items as unknown[];
  expect(requests).toHaveLength(3);
  expect(requests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sample: 'OS-24-0417',
        transformer: 'TR-40517',
        description: 'Buchholz relay alarmed last week; gas analysis.',
        method: gas,
        requester: 'owner',
      }),
      expect.objectContaining({ sample: 'OS-24-0418', transformer: 'TR-40522', method: '' }),
      expect.objectContaining({ sample: 'OS-24-0419', transformer: 'TR-40522', method: water }),
    ]),
  );

  await run('assignment.close', { id: sent.id });
  expect(await read('assignment.get', { id: sent.id })).toMatchObject({ stage: 'closed' });
  expect(await refused(report('r6', 'OS-24-0421', 'Too late.', 'TR-40517'))).toBe('CONFLICT');
  expect(await read('assignment.feed', {}, vera)).toMatchObject({ items: [], more: false });
});

test('the assignee list names the members of the lab', async () => {
  const pattern = await startTestRequestsAssignments();
  close = pattern.close;
  expect(await pattern.read('sampling.assignee.list', {}, vera)).toEqual({
    items: [
      { type: 'person', id: 'owner', label: 'owner (technician)' },
      { type: 'person', id: 'vera', label: 'vera (viewer)' },
    ],
  });
  expect(await refused(pattern.read('sampling.assignee.list', {}, olga))).toBe('FORBIDDEN');
});
