import { chmod, writeFile } from 'node:fs/promises';
import type { ExecutionContext } from '@agent-native/runtime';
import type { HostSession, Sessions } from '@agent-native/adapters/http';

/** Write `{ endpoint, token }` readable by the owner only. */
export async function writeConnectionFile(path: string, endpoint: string, token: string) {
  await writeFile(path, JSON.stringify({ endpoint, token }), { mode: 0o600 });
  await chmod(path, 0o600);
}

/**
 * A second connection file bound to a delegated context, for an agent that runs as a different
 * OS user. The session expires with the grant (or after 30 days without an expiry).
 */
export async function issueAgentConnection(
  sessions: Sessions,
  connection: { context: ExecutionContext; path: string },
  endpoint: string,
): Promise<HostSession> {
  const expiresAt = connection.context.grant?.expiresAt;
  const session = sessions.create(
    connection.context,
    expiresAt === undefined ? 30 * 86_400_000 : Math.max(0, expiresAt - Date.now()),
  );
  await writeConnectionFile(connection.path, endpoint, session.token);
  return session;
}
