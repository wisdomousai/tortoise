import { readFile } from 'node:fs/promises';

export interface ConnectionFile {
  endpoint: string;
  token: string;
}
/** Process clients attach to the running instance, never open its data files. */
export async function readConnection(
  path = process.env.TORTOISE_CONNECTION,
): Promise<ConnectionFile> {
  if (!path)
    throw new Error(
      'Set TORTOISE_CONNECTION to the protected connection file printed by the service',
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
    throw new Error('Connection must use a loopback instance');
  return { endpoint: value.endpoint, token: value.token };
}
