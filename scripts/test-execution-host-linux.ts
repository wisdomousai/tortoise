/**
 * Run the execution host's tests, the bubblewrap ones included, in a Linux container with this
 * checkout mounted at the same path. Paths after the script name other tests to run there, such as
 * an application's own sandbox tests; `plugins/execution-host` when none are given. `IMAGE` names
 * a prebuilt image instead of building one.
 *
 * The container options loosen the container, not the sandbox under test: Docker's own seccomp
 * profile and AppArmor refuse the user namespaces bubblewrap creates, and its masked /proc
 * paths make mounting a fresh /proc fail. Bubblewrap then applies its own namespaces and the
 * plugin's seccomp filter inside.
 */
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const image = process.env.IMAGE ?? 'tortoise-execution-host-test';
const paths = process.argv.slice(2);

async function run(command: string[]) {
  const child = Bun.spawn(command, { stdio: ['inherit', 'inherit', 'inherit'] });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}

if (!process.env.IMAGE)
  await run(['docker', 'build', '-t', image, `${root}/plugins/execution-host/test/linux`]);
await run([
  'docker',
  'run',
  '--rm',
  '--security-opt',
  'seccomp=unconfined',
  '--security-opt',
  'apparmor=unconfined',
  '--security-opt',
  'systempaths=unconfined',
  '-u',
  '1100',
  '-v',
  `${root}:${root}`,
  '-w',
  root,
  '--entrypoint',
  '/usr/local/bin/bun',
  image,
  'test',
  ...(paths.length ? paths : ['plugins/execution-host']),
]);
