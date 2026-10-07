import { createHttpTransport, type Transport } from '@agent-native/client';
import { errorEnvelope, type Catalog } from '@agent-native/contracts';
import { readFile } from 'node:fs/promises';

export interface ConnectionFile {
  endpoint: string;
  token: string;
}
/** Process clients attach to the running authority, never open its data files. */
export async function readConnection(
  path = process.env.AGENT_NATIVE_CONNECTION,
): Promise<ConnectionFile> {
  if (!path)
    throw new Error(
      'Set AGENT_NATIVE_CONNECTION to the protected connection file printed by the service',
    );
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    !value ||
    typeof value !== 'object' ||
    !('endpoint' in value) ||
    !('token' in value) ||
    typeof value.endpoint !== 'string' ||
    typeof value.token !== 'string'
  )
    throw new Error('Invalid connection file');
  const url = new URL(value.endpoint);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.pathname !== '/'
  )
    throw new Error('Connection must use a loopback authority');
  return { endpoint: value.endpoint, token: value.token };
}

/** Testable CLI dispatcher; stdout is exactly one JSON value and failures set a nonzero exit status. */
export async function runCli(
  args: readonly string[],
  client: Transport & { catalog(): Promise<Catalog> },
): Promise<unknown> {
  const [verb, operation, text, ...flags] = args;
  const catalog = await client.catalog();
  if (verb === 'list' || !verb) return catalog;
  const definition = catalog.operations.find((item) => item.id === operation);
  if (!definition) throw new Error('Unknown operation; use list');
  if (verb === 'schema' || verb === 'help') return definition;
  if (verb !== 'call')
    throw new Error(
      'Usage: list | schema <operation> | call <operation> <json> [--key key] [--revisions json]',
    );
  const input: unknown = JSON.parse(text ?? '{}');
  const keyIndex = flags.indexOf('--key');
  const revisionsIndex = flags.indexOf('--revisions');
  if (flags.some((flag, index) => index % 2 === 0 && flag !== '--key' && flag !== '--revisions'))
    throw new Error('Unknown CLI flag');
  return definition.kind === 'query'
    ? client.query(definition.id, input)
    : client.command(definition.id, input, {
        idempotencyKey: keyIndex < 0 ? crypto.randomUUID() : flags[keyIndex + 1],
        expectedRevisions:
          revisionsIndex < 0 ? undefined : JSON.parse(flags[revisionsIndex + 1] ?? '{}'),
      });
}

if (import.meta.main) {
  try {
    const connection = await readConnection();
    const client = createHttpTransport({ baseUrl: connection.endpoint, token: connection.token });
    console.log(JSON.stringify(await runCli(process.argv.slice(2), client)));
  } catch (error) {
    console.log(JSON.stringify({ error: errorEnvelope(error) }));
    process.exitCode = 1;
  }
}
