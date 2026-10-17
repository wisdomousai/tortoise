import { resolve } from 'node:path';
import { scaffoldAdd, type AddRequest } from './add';
import { scaffoldNew } from './new';
import { scaffold } from './scaffold';

const USAGE = `Usage:
  bun run scaffold <absent-target-directory> --name <app-name> [--display-name <label>] [--example <name>]
  bun run scaffold new <absent-target-directory> --name <app-name> [--display-name <label>] [--collection <type>]
  bun run scaffold add collection <type> [--app <directory>]
  bun run scaffold add capability <operation-id> --kind command|query --description <text> [--app <directory>]
  bun run scaffold add target <name> --collection <type> [--app <directory>]`;

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
  if (kind === 'target') return { kind, name, collection: option('--collection') ?? '' };
  throw new Error(USAGE);
}

async function main(args: readonly string[]) {
  const { option, positional } = parse(args);
  if (positional[0] === 'add') {
    const request = addRequest(positional[1], positional[2], option);
    const app = option('--app');
    const result = await scaffoldAdd(request, app ? { application: app } : {});
    console.log(`Wrote ${result.written.length} files in ${result.directory}`);
    // Formatting and generation stay separate steps, so this command starts no processes.
    console.log('Next: bun run format && bun run generate');
    return;
  }
  const isNew = positional[0] === 'new';
  const target = isNew ? positional[1] : positional[0];
  const name = option('--name');
  if (!target || !name) throw new Error(USAGE);
  const displayName = option('--display-name');
  const common = { target, name, ...(displayName ? { displayName } : {}) };
  const collection = option('--collection');
  const example = option('--example');
  const manifest = isNew
    ? await scaffoldNew({ ...common, ...(collection ? { collection } : {}) })
    : await scaffold({ ...common, ...(example ? { example } : {}) });
  console.log(
    `Exported ${manifest.files.length} source files for ${manifest.application.name} to ${resolve(target)}`,
  );
  if (isNew)
    console.log('Next: bun install --frozen-lockfile && bun run generate && bun run check');
}

if (import.meta.main) await main(process.argv.slice(2));
