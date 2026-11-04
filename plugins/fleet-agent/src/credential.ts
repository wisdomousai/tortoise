import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SecretStore } from '@tortoise/kernel/platform';

/** Where the instance's fleet credential is kept between starts. */
export interface CredentialStore {
  read(): Promise<string | undefined>;
  write(token: string): Promise<void>;
}

/**
 * The platform's secret store when it keeps one, otherwise a file only the host's OS account can
 * read, inside the workspace directory: the same protection as the owner's connection file.
 */
export function credentialStore(
  secrets: SecretStore | undefined,
  workspacePath: string,
): CredentialStore {
  if (secrets)
    return {
      read: () => secrets.get('fleet-credential'),
      write: (token) => secrets.set('fleet-credential', token),
    };
  const directory = join(workspacePath, 'fleet-agent');
  const file = join(directory, 'credential');
  return {
    async read() {
      try {
        return (await readFile(file, 'utf8')).trim() || undefined;
      } catch {
        return undefined;
      }
    },
    async write(token) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, token, { mode: 0o600 });
      await rename(temporary, file);
    },
  };
}
