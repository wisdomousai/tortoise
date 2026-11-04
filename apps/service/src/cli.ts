import { createCli } from '@tortoise/host/cli';
import { configuredApplication, starterConfig } from './application';

/** `bun run cli …`: the configured application's command line, named after the starter. */
if (import.meta.main) {
  const config = starterConfig();
  process.exitCode = await createCli(await configuredApplication(), { program: config.name })(
    process.argv.slice(2),
  );
}
