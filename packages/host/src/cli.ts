import { errorEnvelope } from '@agent-native/contracts';
import { PENDING_EXIT_CODE, exitCodes } from '@agent-native/adapters/cli';
import type { AnyApplicationDefinition } from './application';
import { report } from './cli/args';
import { drainCommand, syncCommand } from './cli/integration-commands';
import { mcpCommand } from './cli/mcp';
import { operationCommand } from './cli/operation';
import { serveCommand } from './cli/serve';
import { migrateCommand } from './cli/migrate-command';
import { backupCommand, restoreCommand } from './cli/workspace-commands';
import type { ApplicationManifest } from './manifest';
import { settingsUsage } from './plugins/settings';

const pluginSettingsUsage = (manifest: ApplicationManifest) => {
  const lines = settingsUsage(manifest);
  return lines
    ? `\nPlugin settings (serve, mcp --embedded, sync, drain and --embedded operations):\n${lines}\n`
    : '';
};

const authorityUsage = (program: string, manifest: ApplicationManifest) => `Authority:
  ${program} serve [--workspace dir] [--port n] [--web-root dir] [--grant-file f --grant-connection out]
      [--hosted-workspace name]   keep the workspace in Postgres (AGENT_NATIVE_DATABASE_URL) under a lease
  ${program} mcp [--connection file] | mcp --embedded --grant-file f [--workspace dir]
  ${program} sync [--workspace dir]               pull master data from the system of record once
  ${program} drain [--workspace dir] [--timeout ms]  deliver pending effects; exit ${PENDING_EXIT_CODE} if any remain
  ${program} backup [--workspace dir] --out file  write a verified copy while the host runs
  ${program} restore [--workspace dir] --from file  replace the workspace with a verified backup; the host must be stopped
  ${program} migrate [--workspace dir] [--dry-run]  migrate a copy of the workspace state, check it, then switch; the host must be stopped
${pluginSettingsUsage(manifest)}
Operations run against a live authority (--connection or AGENT_NATIVE_CONNECTION), or in-process
with --embedded [--workspace dir] [--grant-file f]. help, list, schema and workflows work offline.
`;

/**
 * The command line for one application, compiled into one binary by `bun run build:cli`.
 * Returns `main(argv)`, which resolves to the process exit code and never throws: failures are
 * printed as a JSON error envelope with the matching exit code.
 *
 * Trust boundary: identity comes from the launcher, never from operation arguments. Attached
 * calls use the session in a connection file written by the authority. Embedded calls use a
 * grant file prepared by the orchestrator; without one, an embedded call acts as the local
 * workspace owner, which is only appropriate for a human operator on their own machine.
 */
export function createCli(definition: AnyApplicationDefinition, options: { program: string }) {
  const { program } = options;
  return async function main(argv: readonly string[]): Promise<number> {
    const args = [...argv];
    const verb = args[0];
    try {
      if (verb === 'serve') return await serveCommand(definition, args.slice(1));
      if (verb === 'mcp') return await mcpCommand(definition, args.slice(1));
      if (verb === 'drain') return await drainCommand(definition, args.slice(1));
      if (verb === 'sync') return await syncCommand(definition, args.slice(1));
      if (verb === 'backup') return await backupCommand(definition, args.slice(1));
      if (verb === 'restore') return await restoreCommand(definition, args.slice(1));
      if (verb === 'migrate') return await migrateCommand(definition, args.slice(1));
      // Plugin verbs touch no workspace, for example policy checks or log audits.
      const commands = (definition.plugins ?? []).flatMap((plugin) => plugin.commands ?? []);
      for (const command of commands) {
        const code = await command.run(definition.manifest, args);
        if (code !== undefined) return code;
      }
      if (verb === undefined || (verb === 'help' && args.length === 1) || verb === '--help') {
        const usages = commands.map((command) => command.usage(program) + '\n');
        process.stdout.write([authorityUsage(program, definition.manifest), ...usages].join('\n'));
        return await operationCommand(definition, program, ['help']);
      }
      return await operationCommand(definition, program, args);
    } catch (error) {
      const envelope = errorEnvelope(error);
      report({ error: envelope });
      return exitCodes[envelope.code];
    }
  };
}
