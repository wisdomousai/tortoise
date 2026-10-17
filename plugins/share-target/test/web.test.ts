import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '@agent-native/host/host';
import { notesApplication, scheme } from './fixture';

const directories: string[] = [];
afterAll(() => Promise.all(directories.map((path) => rm(path, { recursive: true, force: true }))));

async function serve(application: ReturnType<typeof notesApplication>) {
  const directory = await mkdtemp(join(tmpdir(), 'share-target-'));
  directories.push(directory);
  await mkdir(join(directory, 'web'));
  await writeFile(join(directory, 'web', 'index.html'), '<!doctype html><title>Notes</title>');
  const host = await startHost(application, {
    workspacePath: join(directory, 'workspace'),
    webRoot: join(directory, 'web'),
    integration: false,
    settings: { 'os-scheme': scheme },
  });
  const token = host.sessions.create({ workspaceId: 'local', principalId: 'owner' }).token;
  const call = (path: string, body?: unknown) =>
    fetch(`${host.url}/api/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  /** What the browser does for an installed app: a cross-site top-level POST, no session. */
  const share = (form: FormData | Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(`${host.url}/os/share`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', ...headers },
      body: form instanceof FormData ? form : new URLSearchParams(form as Record<string, string>),
    });
  const claim = (code: string) =>
    call('shell/requests', { platform: 'web', request: { kind: 'claim', code } }).then((response) =>
      response.json(),
    );
  return { host, call, share, claim };
}
const codeOf = (response: Response) =>
  new URL(response.headers.get('location')!, 'http://x').searchParams.get('os-share')!;

describe('share target on the web', () => {
  test('a shared text is held, then the landing session claims it once as a prefill', async () => {
    const { host, call, share, claim } = await serve(notesApplication());
    try {
      const posted = await share({ title: 'Milk', text: 'Buy milk' });
      expect(posted.status).toBe(303);
      const code = codeOf(posted);
      expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);

      // The redirect lands cross-site too; the host serves the frame for exactly that landing.
      const landing = await fetch(`${host.url}/?os-share=${code}`, {
        headers: {
          'sec-fetch-site': 'cross-site',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      });
      expect(landing.status).toBe(200);

      expect(await claim(code)).toEqual({ status: 'delivered', handler: 'note.from-shared-text' });
      expect(await (await call('ui/deliveries')).json()).toMatchObject([
        {
          delivery: {
            type: 'prepare',
            operation: 'notes.create',
            input: { body: 'Buy milk' },
            provenance: { kind: 'share', handler: 'note.from-shared-text' },
          },
        },
      ]);
      expect(await claim(code)).toEqual({ status: 'refused', reason: 'invalid' });
      expect(await claim('A'.repeat(22))).toEqual({ status: 'refused', reason: 'invalid' });

      // A link and its text go to the first handler that accepts either: the link handler.
      const both = await claim(codeOf(await share({ text: 'see', url: 'https://example.com/a' })));
      expect(both).toEqual({ status: 'delivered', handler: 'note.from-shared-link' });
    } finally {
      await host.close();
    }
  });

  test('a shared scan is staged for the claiming session and prefills its reference', async () => {
    const { host, call, share, claim } = await serve(notesApplication());
    try {
      const form = new FormData();
      form.set('file', new File(['%PDF-1'], 'Receipt.pdf', { type: 'application/pdf' }));
      const code = codeOf(await share(form));
      expect(await claim(code)).toEqual({ status: 'delivered', handler: 'note.from-shared-scan' });
      const [{ delivery }] = await (await call('ui/deliveries')).json();
      expect(delivery.input).toMatchObject({
        title: 'Receipt.pdf',
        scan: { size: 6, mediaType: 'application/pdf' },
      });

      // A file no handler accepts, or one over its limit, is dropped unread: nothing is held.
      const large = new FormData();
      large.set('file', new File([new Uint8Array(65)], 'Big.pdf', { type: 'application/pdf' }));
      const image = new FormData();
      image.set('file', new File(['png'], 'a.png', { type: 'image/png' }));
      for (const dropped of [large, image]) {
        const response = await share(dropped);
        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe('/');
      }
    } finally {
      await host.close();
    }
  });

  test('other methods, form types and oversized posts are refused unread', async () => {
    const { host, share } = await serve(notesApplication());
    try {
      expect((await fetch(`${host.url}/os/share`)).status).toBe(405);
      const json = await fetch(`${host.url}/os/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"text":"x"}',
      });
      expect(json.status).toBe(415);
      const huge = new FormData();
      huge.set('text', 'x'.repeat(2_000_000));
      expect((await share(huge)).status).toBe(413);
      // Nothing usable in the post: back to the start page, nothing held.
      expect((await share({ title: 'only a title' })).headers.get('location')).toBe('/');
    } finally {
      await host.close();
    }
  });

  test('a code expires, and only the eight newest posts are held', async () => {
    let now = 1_000_000;
    const { host, share, claim } = await serve(notesApplication({ now: () => now }));
    try {
      const late = codeOf(await share({ text: 'late' }));
      now += 121_000;
      expect(await claim(late)).toEqual({ status: 'refused', reason: 'invalid' });

      const codes: string[] = [];
      for (let index = 0; index < 9; index += 1)
        codes.push(codeOf(await share({ text: `n${index}` })));
      expect(await claim(codes[0]!)).toEqual({ status: 'refused', reason: 'invalid' });
      expect(await claim(codes[8]!)).toMatchObject({ status: 'delivered' });
    } finally {
      await host.close();
    }
  });

  test('a share action is returned to the page, and share handlers need the plugin', async () => {
    const { host, call } = await serve(notesApplication());
    try {
      expect(
        await (
          await call('shell/actions', { action: 'notes.share', params: { text: 'Buy milk' } })
        ).json(),
      ).toEqual({
        status: 'instruction',
        instruction: { kind: 'share', action: 'notes.share', text: 'Buy milk' },
      });
    } finally {
      await host.close();
    }
    await expect(serve(notesApplication({ share: false }))).rejects.toThrow('share');
  });
});
