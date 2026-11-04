import { describe, expect, test } from 'bun:test';
import { defaultPorts } from '@tortoise/host';
import { passOnce, type Runner } from '@tortoise/workflows/runner';
import { at, dispatched, open, rita } from './survey';

const WEEK = 7 * 86_400_000;
const integration = at('integration');

type Instance = {
  id: string;
  status: string;
  step?: string;
  error?: { step: string; code: string };
};
type Filing = { id: string; target: string; sync: string; sorRef?: string; withdraws?: string };

/**
 * An unlinked nameplate capture handed to `survey.capture-to-eam` by the manager, with a runner
 * driven one pass at a time on a fake clock, as a serving host would drive it.
 */
async function started() {
  // The kernel checks grant expiry on its own clock, so this one starts at the same time.
  const clock = { at: Date.now() };
  const survey = await open(undefined, { now: () => clock.at });
  const { q2, assignment } = await dispatched(survey);
  // A node outside the survey: the capture is recorded unlinked.
  const g2 = await survey.node(undefined, '=G2', 'Generator 2');
  await survey.capture('cap', assignment.id, g2.id, { manufacturer: 'Siemens', serial: 'S-77' });
  const instance = await survey.command<Instance>('capture.file-workflow', {
    id: 'cap',
    nodeId: q2.id,
  });
  const errors: unknown[] = [];
  const runner: Runner = {
    context: {
      application: survey.application,
      workspaceId: 'local',
      ports: defaultPorts,
      delegate: (grant) => ({
        workspaceId: 'local',
        principalId: 'local-user',
        grant: { ...grant, principalId: 'local-user', workspaceId: 'local' },
      }),
      onError: (_scope, error) => errors.push(error),
    },
    cursors: new Map(),
  };
  const pass = () => passOnce(runner);
  const get = () => survey.query<Instance>('workflow.get', { id: instance.id });
  /** Linked, sent to the model and read: the instance waits for a reviewer. */
  const proposed = async () => {
    await pass();
    await pass();
    await survey.complete();
    await pass();
    expect(await get()).toMatchObject({ status: 'waiting', step: 'reviewed' });
  };
  const accept = async () =>
    survey.command(
      'assignment.extraction.accept',
      {
        id: (await survey.reading('cap')).reportId,
        values: { manufacturer: 'Siemens', serial: 'S-77' },
      },
      rita,
    );
  /** Accepted, filed into the EAM and its export requested. */
  const filed = async () => {
    await proposed();
    await accept();
    await pass();
    await pass();
    await survey.complete();
    await pass();
    await pass();
    expect(await get()).toMatchObject({ status: 'running', step: 'export' });
  };
  const completeExport = async (accepted: boolean) => {
    const [effect] = await survey.application.pendingEffects(at('local-user'), {
      target: 'export',
    });
    await survey.command(
      'filing.export.complete',
      {
        effectId: effect!.id,
        outcome: accepted
          ? { status: 'accepted', externalRef: 'folder-1' }
          : { status: 'rejected', code: 'EXPORT_REFUSED', message: 'The directory is full' },
      },
      integration,
    );
  };
  const filings = async () => (await survey.query<{ items: Filing[] }>('filing.list', {})).items;
  return {
    survey,
    clock,
    q2,
    instance,
    errors,
    pass,
    get,
    proposed,
    accept,
    filed,
    completeExport,
    filings,
  };
}

describe('survey.capture-to-eam', () => {
  test('a capture is linked, read, reviewed, filed into the EAM and exported', async () => {
    const run = await started();
    await run.filed();
    await run.completeExport(true);
    await run.pass();
    expect(await run.get()).toMatchObject({ status: 'succeeded' });
    const eam = (await run.filings()).find((filing) => filing.target === 'eam')!;
    expect(eam).toMatchObject({ sync: 'accepted', sorRef: 'EAM-2001' });
    expect(run.survey.eam().assets.get('EAM-2001')).toMatchObject({
      designation: '=G1-Q2',
      status: 'active',
      attributes: { manufacturer: 'Siemens', serial: 'S-77' },
    });
    expect(run.errors).toEqual([]);
  });

  test('a refused export withdraws the EAM filing, and the EAM retires the asset it created', async () => {
    const run = await started();
    await run.filed();
    await run.completeExport(false);
    await run.pass();
    expect(await run.get()).toMatchObject({
      status: 'compensating',
      step: 'file',
      error: { step: 'export', code: 'EXPORT_REFUSED' },
    });
    await run.pass();
    expect((await run.get()).status).toBe('compensated');
    await run.survey.complete();
    const withdrawal = (await run.filings()).find((filing) => filing.withdraws);
    expect(withdrawal).toMatchObject({ target: 'eam', sync: 'accepted' });
    expect(run.survey.eam().assets.get('EAM-2001')?.status).toBe('retired');
    // The node no longer names the asset, so filing it again creates a new one.
    const node = await run.survey.query<{ assetId?: string }>('structure.node.get', {
      id: run.q2.id,
    });
    expect(node.assetId).toBeUndefined();
    expect(run.errors).toEqual([]);
  });

  test('cancelling while it waits for review ends it with nothing filed', async () => {
    const run = await started();
    await run.proposed();
    await run.survey.command('workflow.cancel', { id: run.instance.id });
    expect((await run.get()).status).toBe('cancelled');
    await run.accept();
    await run.pass();
    expect(await run.filings()).toEqual([]);
  });

  test('a review that does not come within a week fails the instance before filing', async () => {
    const run = await started();
    await run.proposed();
    run.clock.at += WEEK;
    await run.pass();
    expect(await run.get()).toMatchObject({
      status: 'failed',
      error: { step: 'reviewed', code: 'TIMEOUT' },
    });
    expect(await run.filings()).toEqual([]);
  });
});
