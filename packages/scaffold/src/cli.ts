import { resolve } from 'node:path';
import { scaffold } from './scaffold';

if (import.meta.main) {
  const args = process.argv.slice(2);
  const target = args[0];
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const name = option('--name');
  if (!target || !name)
    throw new Error(
      'Usage: bun run scaffold <absent-target-directory> --name <app-name> [--display-name <label>] [--example <name>]',
    );
  const example = option('--example');
  const manifest = await scaffold({
    target,
    name,
    displayName: option('--display-name'),
    ...(example ? { example } : {}),
  });
  console.log(
    `Exported ${manifest.files.length} source files for ${manifest.application.name} to ${resolve(target)}`,
  );
}
