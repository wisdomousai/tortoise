import { canonicalJson } from '@agent-native/contracts';
import { commandWords, synopsis } from '@agent-native/adapters/cli-syntax';
import { loadManifest, readStarterConfig, type ApplicationManifest } from '@agent-native/host';
import { deploymentCatalog, deploymentComponents } from '@agent-native/host/components';
import { dataFlowsMarkdown, securityManifest } from '@agent-native/compliance';
import { agentSkillSection, agentsMarkdown, agentsOf } from './agent-reference';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * The reference artifacts derived from an application's catalog: contract, OpenAPI, operation and
 * workflow references, the agent skill, and the security manifest and data flows. `bun run
 * generate` writes them to `dist/reference/<id>/` for reading; `bun run bundle create` builds the
 * contract and security manifest into a signed bundle. Nothing commits them.
 *
 * Only pure manifests and contracts are imported here. Generating documentation must never start
 * a host, open a workspace, acquire credentials or load a provider SDK.
 */
export const root = resolve(import.meta.dir, '..');
export const config = readStarterConfig(join(root, 'app.config.json'), {});
// The compiled CLI is named after the starter (`bun run build:cli`).
const program = config.name;

/**
 * Every application this checkout can host: the configured one, each example and each sample. The catalog,
 * and so every generated artifact, belongs to one application.
 */
export async function applications(): Promise<ApplicationManifest[]> {
  const found = new Map<string, ApplicationManifest>();
  const configured = await loadManifest(config);
  found.set(configured.id, configured);
  for (const layer of ['examples', 'samples'])
    for (const entry of await readdir(join(root, layer), { withFileTypes: true }).catch(() => []))
      if (
        entry.isDirectory() &&
        (await Bun.file(join(root, layer, entry.name, 'manifest.ts')).exists())
      ) {
        const manifest = await loadManifest({
          ...config,
          application: join(root, layer, entry.name),
        });
        if (found.has(manifest.id) && manifest.id !== configured.id)
          throw new Error(`Two applications have the id ${manifest.id}`);
        found.set(manifest.id, manifest);
      }
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Every artifact for one application, by path relative to its reference directory. */
export function artifacts(manifest: ApplicationManifest) {
  // The deployment catalog: modules plus the host's and the application's components, so the
  // contract and the security artifacts show every declared destination, device and process.
  const catalog = deploymentCatalog(manifest);
  // Declarations, not a site's bindings: `network export --site` applies a policy.
  const security = securityManifest({
    application: manifest.id,
    catalog,
    components: deploymentComponents(manifest),
  });
  const cliCommand = (id: string) =>
    `${program} ${commandWords(catalog.operations.find((operation) => operation.id === id)!).join(' ')}`;
  const paths = Object.fromEntries(
    catalog.operations.map((operation) => [
      `/api/v1/${operation.kind === 'command' ? 'commands' : 'queries'}/${operation.id}`,
      {
        post: {
          operationId: operation.id,
          summary: operation.description || operation.id,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    input: operation.inputSchema,
                    ...(operation.kind === 'command'
                      ? {
                          idempotencyKey: { type: 'string' },
                          expectedRevisions: {
                            type: 'object',
                            additionalProperties: { type: 'integer', minimum: 0 },
                          },
                        }
                      : {}),
                  },
                  required: operation.kind === 'command' ? ['input', 'idempotencyKey'] : ['input'],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Authorized result and snapshot cursor',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      [operation.kind === 'command' ? 'result' : 'data']: operation.outputSchema,
                      cursor: { type: 'string' },
                      authorizationRevision: { type: 'integer' },
                    },
                    required: [
                      operation.kind === 'command' ? 'result' : 'data',
                      'cursor',
                      'authorizationRevision',
                    ],
                  },
                },
              },
            },
            '403': { description: 'Grants and policy do not permit the operation' },
            '409': { description: 'Revision or idempotency conflict' },
          },
        },
      },
    ]),
  );
  return new Map([
    ['contract.json', JSON.stringify(JSON.parse(canonicalJson(catalog)), null, 2) + '\n'],
    [
      'openapi.json',
      JSON.stringify(
        {
          openapi: '3.1.0',
          info: { title: `${manifest.title} interaction API`, version: '1.0.0' },
          paths,
        },
        null,
        2,
      ) + '\n',
    ],
    [
      'operations.md',
      '# Generated operation reference\n\nGenerated by `bun run generate`. Change feature descriptors, then regenerate.\n\n' +
        catalog.operations
          .map(
            (operation) =>
              `## ${operation.id}\n\n${operation.description || operation.id}\n\n- Kind: ${operation.kind}\n- MCP: \`${operation.mcpName}\`\n- Permission: \`${operation.permission.action}\` on \`${operation.permission.resourceType}\`\n- UI: ${operation.ui.binding ?? operation.ui.exception}\n${operation.integration ? `- System of record: forwarded to \`${operation.integration.target}\` through the outbox. A receipt proves the local commit, not acceptance by the target.\n` : ''}${operation.remote ? `- System of record: reads \`${operation.remote.target}\` live when called, as ${operation.remote.identity === 'caller' ? 'the caller' : 'the caller, or a service account when the caller has no credential'}. Nothing is stored; the result reports the source status and fetch time.\n` : ''}${agentsOf(catalog, operation.id)}- CLI: \`${synopsis(operation, program)}\`\n\nInput:\n\n\`\`\`json\n${JSON.stringify(operation.inputSchema, null, 2)}\n\`\`\`\n\nOutput:\n\n\`\`\`json\n${JSON.stringify(operation.outputSchema, null, 2)}\n\`\`\`\n`,
          )
          .join('\n'),
    ],
    [
      'workflows.md',
      '# Application workflows\n\n' +
        catalog.workflows
          .map(
            (workflow) =>
              `## ${workflow.id}\n\n${workflow.text}\n\nOperations: ${workflow.operations.map((id) => `\`${id}\``).join(', ')}.\n`,
          )
          .join('\n'),
    ],
    ['agents.md', agentsMarkdown(catalog)],
    ['security-manifest.json', json(security)],
    ['data-flows.md', dataFlowsMarkdown(security)],
    [
      'application-skill/SKILL.md',
      '---\nname: use-application\ndescription: Operate this application through its registered MCP capabilities, inspect scoped data, and apply authorized business commands. Use when asked to work in the connected application.\n---\n\n# Use the application\n\nRead the `app://contract` MCP resource and discover current tools before acting. Identity and delegation come from the host; never supply roles or principals in tool arguments. Query the current object and revision before changing it.\n\nQuery tools take `{ "input": ... }`. Commands take `{ "input": ..., "idempotencyKey": "unique-request-id", "expectedRevisions": { "type:id": 1 } }`. Keep the same key and exact request when retrying after a lost response. A conflict requires a new query and deliberate reconciliation. A successful command receipt proves committed work; streamed agent text does not.\n\n' +
        `## From a shell\n\nThe same operations are subcommands of the \`${program}\` binary. Run \`${program} help\` and \`${program} help <command>\` for generated flags; \`help\`, \`schema\` and \`workflows\` work without an instance. Add \`--embedded --workspace <dir>\` to run in-process in a sandbox, or attach to a running instance with \`--connection <file>\`; your identity comes from that file or the launcher's grant file, never from flags. Pass \`--key <id>\` on commands and reuse it when retrying, \`--dry-run\` to validate first, and \`--output text\` for tables. Branch on the exit status: 0 ok, 2 invalid input, 3 not found, 4 forbidden, 5 conflict, 6 idempotency conflict, 7 cancelled, 8 unavailable (for example the audit log in fail-closed mode). Before a sandbox is discarded, \`${program} drain\` must exit 0; 75 means captured work has not reached the system of record yet.\n\n` +
        agentSkillSection(catalog) +
        catalog.workflows
          .map(
            (workflow) =>
              `## ${workflow.id}\n\n${workflow.text}\n\nTools: ${workflow.operations.map((id) => `\`${catalog.operations.find((operation) => operation.id === id)!.mcpName}\``).join(', ')}.\n\nCLI: ${workflow.operations.map((id) => `\`${cliCommand(id)}\``).join(', ')}.\n`,
          )
          .join('\n'),
    ],
  ]);
}
