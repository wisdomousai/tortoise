import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dispatched, open, rita } from './survey';

const worker = resolve(import.meta.dir, '../export/worker.ts');
const directory = await mkdtemp(join(tmpdir(), 'tortoise-survey-export-'));
afterAll(() => rm(directory, { recursive: true, force: true }));

/** A deployment policy that binds the reference export process to `exportDirectory` under Bun. */
async function deploymentPolicy(exportDirectory: string) {
  const path = join(directory, `policy-${crypto.randomUUID()}.json`);
  await writeFile(
    path,
    JSON.stringify({
      profile: 'desktop-local',
      audit: { mode: 'best-effort' },
      processes: {
        'filing-export': { executable: process.execPath, args: [worker, exportDirectory] },
      },
    }),
  );
  return { 'deployment-policy': path };
}

/** A hub with breaker =G1-Q2 surveyed and its serial accepted from one nameplate photo. */
async function surveyed(settings?: Record<string, string>) {
  const survey = await open(settings);
  const { q2, assignment } = await dispatched(survey);
  const lines = { manufacturer: 'Siemens', serial: 'S-77' };
  // The capture uploads the same bytes, so this is its photo.
  const photo = await survey.photo(lines);
  await survey.capture('cap', assignment.id, q2.id, lines);
  await survey.read('cap');
  await survey.complete();
  await survey.command(
    'assignment.extraction.accept',
    { id: (await survey.reading('cap')).reportId, values: lines },
    rita,
  );
  return { survey, q2, photo };
}

type Filing = { id: string; target: string; sync: string; sorRef?: string };

describe('export directory', () => {
  test('an unbound export waits, independent of the EAM filing', async () => {
    const { survey, q2 } = await surveyed();
    await survey.command('filing.export', { nodeId: q2.id });
    // The EAM filing of the same node is its own filing; a second export is not.
    await survey.command('filing.file', { nodeId: q2.id });
    await expect(survey.command('filing.export', { nodeId: q2.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await survey.deliver('export')).toMatchObject({ retried: 1 });
    expect(await survey.query('filing.export.status', {})).toMatchObject({
      pending: 1,
      accepted: 0,
    });
    await survey.complete();
    const items = (await survey.query<{ items: Filing[] }>('filing.list', {})).items;
    expect(items.map(({ target, sync }) => [target, sync]).sort()).toEqual([
      ['eam', 'accepted'],
      ['export', 'pending'],
    ]);
  });

  test('a bound export writes one folder with the record and its photos', async () => {
    const exportDirectory = join(directory, 'out');
    await mkdir(exportDirectory);
    const { survey, q2, photo } = await surveyed(await deploymentPolicy(exportDirectory));
    await expect(survey.command('filing.export', { nodeId: q2.id }, rita)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const filing = await survey.command<Filing>('filing.export', { nodeId: q2.id });
    expect(filing).toMatchObject({ target: 'export', sync: 'pending' });
    expect(await survey.deliver('export')).toMatchObject({ accepted: 1 });

    const folder = `G1-Q2_${filing.id}`;
    expect(await readdir(exportDirectory)).toEqual([folder]);
    const record = JSON.parse(await readFile(join(exportDirectory, folder, 'record.json'), 'utf8'));
    const hex = photo.digest.slice('sha256:'.length);
    expect(record).toMatchObject({
      filingId: filing.id,
      designation: '=G1-Q2',
      scheme: 'iec81346',
      attributes: { manufacturer: 'Siemens', serial: 'S-77' },
      filedBy: 'local-user',
      photos: [{ file: `photos/${hex}.png`, digest: photo.digest, mediaType: 'image/png' }],
    });
    const bytes = await readFile(join(exportDirectory, folder, 'photos', `${hex}.png`));
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(photo.digest);
    const listed = (await survey.query<{ items: Filing[] }>('filing.list', { nodeId: q2.id }))
      .items[0];
    expect(listed).toMatchObject({ target: 'export', sync: 'accepted', sorRef: folder });
    expect(await survey.query('filing.export.status', {})).toMatchObject({ accepted: 1 });
  });

  test('the export process reports a folder it already wrote as written', async () => {
    const exportDirectory = join(directory, 'again');
    await mkdir(exportDirectory);
    const data = Buffer.from('photo');
    const digest = `sha256:${createHash('sha256').update(data).digest('hex')}`;
    const request = (id: string) => ({
      id,
      folder: 'G1-Q2_f1',
      record: { designation: '=G1-Q2' },
      photos: [{ file: `photos/${digest.slice(7)}.png`, digest, data: data.toString('base64') }],
    });
    const run = async (body: unknown) => {
      const child = Bun.spawn([process.execPath, worker, exportDirectory], {
        stdin: new TextEncoder().encode(`${JSON.stringify(body)}\n`),
        stdout: 'pipe',
      });
      return JSON.parse(await new Response(child.stdout).text());
    };
    expect(await run(request('e1'))).toEqual({ id: 'e1', folder: 'G1-Q2_f1' });
    expect(await run(request('e1'))).toEqual({ id: 'e1', folder: 'G1-Q2_f1' });
    expect(await run(request('e2'))).toEqual({
      id: 'e2',
      error: 'The folder holds another filing',
    });
    // A photo that does not match its digest, or a folder outside the directory, is refused.
    const tampered = request('e3');
    tampered.photos[0]!.data = Buffer.from('other').toString('base64');
    tampered.folder = 'G1-Q2_f3';
    expect(await run(tampered)).toEqual({ id: 'e3', error: 'A photo does not match its digest' });
    expect((await run({ ...request('e4'), folder: '../escape' })).error).toBeDefined();
    expect((await readdir(exportDirectory)).sort()).toEqual(['G1-Q2_f1']);
  });
});
