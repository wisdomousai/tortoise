import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { readStarterConfig } from '@agent-native/host/config';

const root = resolve(import.meta.dir, '..');

/**
 * Write a static entry for one application, for builds that cannot follow the starter's runtime
 * resolution (`bun build --compile` bundles only what it can see). The entry imports the
 * configured application, or `application` when given (a package name or a directory), and runs
 * the starter's CLI or service with it, stamped with `builtAt` so the host knows when the build
 * was made and reports its best-before date. Returns the entry path inside `directory`.
 */
export async function writeApplicationEntry(
  kind: 'cli' | 'service',
  directory: string,
  application?: string,
  builtAt = new Date().toISOString(),
): Promise<string> {
  const config = readStarterConfig(
    join(root, 'app.config.json'),
    application ? { AGENT_NATIVE_APPLICATION: application } : process.env,
  );
  const definition = isAbsolute(config.application)
    ? Bun.resolveSync(join(config.application, 'application'), root)
    : Bun.resolveSync(`${config.application}/application`, root);
  const stamp = [
    `import { stampBuild } from ${JSON.stringify(Bun.resolveSync('@agent-native/kernel/build', root))};`,
    `import definition from ${JSON.stringify(definition)};`,
    `const application = stampBuild(definition, ${JSON.stringify(builtAt)});`,
  ];
  const lines =
    kind === 'cli'
      ? [
          `import { createCli } from ${JSON.stringify(Bun.resolveSync('@agent-native/host/cli', root))};`,
          ...stamp,
          `process.exitCode = await createCli(application, { program: ${JSON.stringify(config.name)} })(process.argv.slice(2));`,
        ]
      : [
          `import { runService } from ${JSON.stringify(resolve(root, 'apps/service/src/index.ts'))};`,
          ...stamp,
          `await runService(application);`,
        ];
  await mkdir(directory, { recursive: true });
  const entry = join(directory, `${kind}-entry.ts`);
  await writeFile(entry, lines.join('\n') + '\n');
  return entry;
}
