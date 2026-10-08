import { errorEnvelope } from '@agent-native/contracts';
import { PENDING_EXIT_CODE, exitCodes } from '@agent-native/adapters/cli';
import type { AnyApplicationDefinition } from './application';
import { assuranceCommand, assuranceUsage } from './assurance-cli';
import { report } from './cli/args';
import { drainCommand, syncCommand } from './cli/integration-commands';
import { mcpCommand } from './cli/mcp';
import { operationCommand } from './cli/operation';
import { serveCommand } from './cli/serve';

const authorityUsage = (program: string) => `Authority:
  ${program} serve [--workspace dir] [--port n] [--web-root dir] [--grant-file f --grant-connection out]
  ${program} mcp [--connection file] | mcp --embedded --grant-file f [--workspace dir]
  ${program} sync [--workspace dir]               pull master data from the system of record once
  ${program} drain [--workspace dir] [--timeout ms]  deliver pending effects; exit ${PENDING_EXIT_CODE} if any remain

Security (serve, mcp --embedded, sync, drain and --embedded operations):
  --site-policy file   bind declared destinations (AGENT_NATIVE_SITE_POLICY); absent: isolated
  --audit-log dir      audit event log directory (AGENT_NATIVE_AUDIT_LOG); default <workspace>/audit

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
      // Touching no workspace: policy checks, rule export, log audit.
      const assurance = await assuranceCommand(definition.manifest, args);
      if (assurance !== undefined) return assurance;
      if (verb === undefined || (verb === 'help' && args.length === 1) || verb === '--help') {
        process.stdout.write(authorityUsage(program) + '\n' + assuranceUsage(program) + '\n');
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
