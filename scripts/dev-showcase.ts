/**
 * Start several examples at once, each on its own port and workspace, and print their links.
 *
 *   bun run dev:showcase                          every example with a `dev:web` script
 *   bun run dev:showcase tool-store parts-desk    the named examples
 *
 * Each example runs as `bun run dev:web` in its directory would: one application per instance,
 * so each one gets its own browser tab and its own sign-in. The launches run one after another,
 * because each builds its web frame first. A launch link signs in once and expires after one
 * minute; for a fresh one, restart that example alone with `bun run dev:web` in its directory.
 * Ctrl-C stops them all. Nothing is discovered and no credential is read.
 */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const examples = join(root, 'showcase/examples');

interface Example {
  readonly name: string;
  readonly directory: string;
}

async function startable(): Promise<Example[]> {
  const found: Example[] = [];
  for (const name of (await readdir(examples)).sort()) {
    const directory = join(examples, name);
    const manifest = (await Bun.file(join(directory, 'package.json'))
      .json()
      .catch(() => undefined)) as { scripts?: Record<string, string> } | undefined;
    if (manifest?.scripts?.['dev:web']) found.push({ name, directory });
  }
  return found;
}

const available = await startable();
const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !available.some((example) => example.name === name));
if (unknown.length) {
  console.error(
    `No example with a dev:web script: ${unknown.join(', ')}. ` +
      `Available: ${available.map((example) => example.name).join(', ')}`,
  );
  process.exit(1);
}
const chosen = requested.length
  ? available.filter((example) => requested.includes(example.name))
  : available;

const children: Bun.Subprocess[] = [];
const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

/** The link line `dev-example.ts` prints once the instance serves. */
const linkLine = /^(.+): (?:open|sign in at) (\S+)/;

/** Start one example and resolve with its link, or undefined when it stops before serving. */
async function start(example: Example): Promise<string | undefined> {
  const child = Bun.spawn(['bun', 'run', 'dev:web'], {
    cwd: example.directory,
    env: { ...process.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  children.push(child);
  let link: ((url: string | undefined) => void) | undefined;
  const served = new Promise<string | undefined>((resolve) => (link = resolve));
  const relay = async (stream: ReadableStream<Uint8Array>, write: (line: string) => void) => {
    const decoder = new TextDecoder();
    let rest = '';
    for await (const chunk of stream) {
      const lines = (rest + decoder.decode(chunk, { stream: true })).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        write(`[${example.name}] ${line}`);
        const match = linkLine.exec(line.trim());
        if (match) link?.(match[2]);
      }
    }
  };
  void relay(child.stdout, (line) => console.log(line));
  void relay(child.stderr, (line) => console.error(line));
  void child.exited.then(() => link?.(undefined));
  return served;
}

const links: { name: string; url: string | undefined }[] = [];
for (const example of chosen) links.push({ name: example.name, url: await start(example) });

const width = Math.max(...links.map((entry) => entry.name.length));
console.log('\nRunning examples:');
for (const { name, url } of links)
  console.log(`  ${name.padEnd(width)}  ${url ?? 'stopped before serving; see its output above'}`);
console.log(
  '\nEach launch link signs in once within one minute. Ctrl-C stops every example.\n' +
    'For a fresh link, restart one example with `bun run dev:web` in its directory.',
);
if (links.every((entry) => !entry.url)) stop();
