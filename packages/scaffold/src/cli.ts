import { resolve } from 'node:path';
import { scaffoldAdd, type AddRequest } from './add';
import { scaffoldNew } from './new';
import { scaffold } from './scaffold';
import { installedFramework } from './versions';

const USAGE = `Usage:
  bun run scaffold <absent-target-directory> --name <app-name> [--display-name <label>] [--example <name>]
  bun run scaffold new <absent-target-directory> --name <app-name> [--display-name <label>] [--collection <type>] [--published | --registry <url>]
  bun run scaffold add collection <type> [--app <directory>]
  bun run scaffold add capability <operation-id> --kind command|query --description <text> [--app <directory>]
  bun run scaffold add target <name> --collection <type> [--app <directory>]
  bun run scaffold add agent <name> --collection <type> [--app <directory>]
  bun run scaffold versions [<application-directory>]`;

function parse(args: readonly string[]) {
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const positional = args.filter(
    (arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'),
  );
  return { option, positional };
}

function addRequest(
  kind: string | undefined,
  name: string | undefined,
  option: (name: string) => string | undefined,
): AddRequest {
  if (!name) throw new Error(USAGE);
  if (kind === 'collection') return { kind, name };
  if (kind === 'capability') {
    const operationKind = option('--kind');
    if (operationKind !== 'command' && operationKind !== 'query') throw new Error(USAGE);
    return { kind, id: name, operationKind, description: option('--description') ?? '' };
  }
  if (kind === 'target' || kind === 'agent')
    return { kind, name, collection: option('--collection') ?? '' };
  throw new Error(USAGE);
}

async function main(args: readonly string[]) {
  const { option, positional } = parse(args);
  if (positional[0] === 'versions') {
    const installed = await installedFramework(resolve(positional[1] ?? '.'));
    if (installed.problem) {
      console.error(installed.problem);
      process.exitCode = 1;
      return;
    }
    const [version, names] = Object.entries(installed.versions)[0] ?? [];
    console.log(
      version
        ? `${names!.length} framework packages installed at ${version}`
        : 'No framework packages installed',
    );
    return;
  }
  if (positional[0] === 'add') {
    const request = addRequest(positional[1], positional[2], option);
    const app = option('--app');
    const result = await scaffoldAdd(request, app ? { application: app } : {});
    console.log(`Wrote ${result.written.length} files in ${result.directory}`);
    if (result.policy)
      console.log(`Listed the target's destination as disabled in ${result.policy}; bind it there`);
    // Formatting and generation stay separate steps, so this command starts no processes.
    console.log('Next: bun run format && bun run generate');
    return;
  }
  const isNew = positional[0] === 'new';
  const registry = option('--registry');
  const published =
    registry || args.includes('--published') ? { ...(registry ? { registry } : {}) } : undefined;
  const target = isNew ? positional[1] : positional[0];
  const name = option('--name');
  if (!target || !name) throw new Error(USAGE);
  const displayName = option('--display-name');
  const common = { target, name, ...(displayName ? { displayName } : {}) };
  const collection = option('--collection');
  const example = option('--example');
  const manifest = isNew
    ? await scaffoldNew({
        ...common,
        ...(collection ? { collection } : {}),
        ...(published ? { published } : {}),
      })
    : await scaffold({ ...common, ...(example ? { example } : {}) });
  console.log(
    `Exported ${manifest.files.length} source files for ${manifest.application.name} to ${resolve(target)}`,
  );
  if (isNew && published)
    // No lockfile is exported: the first install against the registry writes it.
    console.log(
      `Framework ${manifest.framework!.version} installs from ${published.registry ?? 'the npm registry'}. Next: bun install && bun run format && bun run generate && bun run check, then commit bun.lock`,
    );
  else if (isNew)
    // A source export copies framework READMEs and skills that link to omitted examples, so the
    // full `bun run check` fails there; name the checks that pass.
    console.log(
      'Next: bun install --frozen-lockfile && bun run format && bun run generate && bun run typecheck && bun test',
    );
}

if (import.meta.main) await main(process.argv.slice(2));
