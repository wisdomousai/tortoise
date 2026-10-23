import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecretStore } from '@agent-native/kernel/platform';

/** What a connection keeps secret: the peer credential and the assertion signing key. */
export interface ConnectionSecret {
  readonly peerId: string;
  readonly token: string;
  readonly privateKey: string;
}

export interface ConnectionSecrets {
  read(target: string): Promise<ConnectionSecret | undefined>;
  write(target: string, secret: ConnectionSecret): Promise<void>;
  delete(target: string): Promise<void>;
}

const parse = (text: string | undefined): ConnectionSecret | undefined => {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as Partial<ConnectionSecret>;
    return typeof value.peerId === 'string' &&
      typeof value.token === 'string' &&
      typeof value.privateKey === 'string'
      ? { peerId: value.peerId, token: value.token, privateKey: value.privateKey }
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The platform's secret store when it keeps one, otherwise one file per target that only the
 * host's OS account can read, inside the workspace directory: the same protection as the owner's
 * connection file. Never in application state, receipts or the journal.
 */
export function connectionSecrets(
  secrets: SecretStore | undefined,
  workspacePath: string,
): ConnectionSecrets {
  const name = (target: string) => `peer-connection-${target}`;
  if (secrets)
    return {
      read: async (target) => parse(await secrets.get(name(target))),
      write: (target, secret) => secrets.set(name(target), JSON.stringify(secret)),
      delete: (target) => secrets.delete(name(target)),
    };
  const directory = join(workspacePath, 'peer-link');
  const file = (target: string) => join(directory, `${target}.json`);
  return {
    async read(target) {
      return parse(await readFile(file(target), 'utf8').catch(() => undefined));
    },
    async write(target, secret) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const temporary = `${file(target)}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(secret), { mode: 0o600 });
      await rename(temporary, file(target));
    },
    async delete(target) {
      await rm(file(target), { force: true });
    },
  };
}
