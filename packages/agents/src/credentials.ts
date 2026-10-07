/** Authority-only storage. Implementations must distinguish missing credentials from
 * inaccessible storage, and must not silently persist secrets in files or SQLite. */
export interface CredentialVault {
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
  remove(account: string): Promise<boolean>;
}
type NativeBinding = Pick<typeof import('@napi-rs/keyring'), 'AsyncEntry'>;
let packagedBinding: NativeBinding | undefined;
/** Composition-root hook for a statically embedded target .node addon. Call once
 * before starting the service; the packaging entrypoint owns this binding. */
export function installNativeCredentialBinding(binding: NativeBinding) {
  if (packagedBinding) throw new Error('Native credential binding is already installed');
  packagedBinding = binding;
}

/** Native OS vault shared by service-only and Electron launches. Linux is explicitly
 * pinned to persistent Secret Service; keyutils auto-fallback is prohibited. */
export class OsCredentialVault implements CredentialVault {
  constructor(private readonly namespace: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,120}$/.test(namespace))
      throw new Error('Invalid credential namespace');
  }
  private async entry(account: string) {
    if (!account || account.length > 256 || /[\r\n\0]/.test(account))
      throw new Error('Invalid credential account identifier');
    // Lazy loading keeps credentials and native addons out of fixture-only startup.
    const { AsyncEntry } = packagedBinding ?? (await import('@napi-rs/keyring'));
    return new AsyncEntry(this.namespace, account, { linux: { store: 'secret-service' } });
  }
  async get(account: string) {
    return (await this.entry(account)).getPassword();
  }
  async set(account: string, secret: string) {
    if (!secret || secret.length > 128_000)
      throw new Error('Credential payload is empty or too large');
    await (await this.entry(account)).setPassword(secret);
  }
  async remove(account: string) {
    return (await this.entry(account)).deleteCredential();
  }
}

/** Explicit ephemeral vault for deterministic tests only. It is never a fallback for
 * locked/unavailable native stores and must be selected by the test composition root. */
export class MemoryCredentialVault implements CredentialVault {
  private readonly values = new Map<string, string>();
  async get(account: string) {
    return this.values.get(account);
  }
  async set(account: string, secret: string) {
    this.values.set(account, secret);
  }
  async remove(account: string) {
    return this.values.delete(account);
  }
}
