/** A file the bundle carries, by its path under `files/`. */
export interface BundleFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

/**
 * What a bundle may reach and run, in the shape the generated security manifest uses. Only the
 * fields admission compares are named; the rest of each entry is kept as declared.
 */
export interface BundleRequirements {
  readonly network: readonly {
    readonly id: string;
    readonly direction: string;
    readonly scope: string;
    readonly host?: string;
    readonly protocol?: string;
    readonly port?: number;
  }[];
  readonly devices: readonly { readonly id: string }[];
  readonly processes: readonly { readonly id: string; readonly executable: string }[];
  readonly os?: {
    readonly handlers?: readonly { readonly id: string }[];
    readonly actions?: readonly { readonly id: string; readonly reaches?: string }[];
  };
}

/** The signed description of one bundle. */
export interface BundleManifest {
  readonly format: 1;
  readonly application: string;
  readonly version: string;
  /** The platform the binary runs on, for example `linux-x64`. */
  readonly platform: string;
  readonly createdAt: string;
  /**
   * `YYYY-MM-DD`: the build date plus the application's shelf life, when it declares one. Signed
   * with the rest, so a site shows it and cannot change it; nothing refuses a bundle past it.
   */
  readonly bestBefore?: string;
  /** Storage schema version the build writes; a site refuses one its storage cannot read. */
  readonly storageSchema: number;
  /** SHA-256 of the canonical catalog, so a site can tell builds of one contract apart. */
  readonly catalogDigest: string;
  readonly requirements: BundleRequirements;
  /** Sorted by path. */
  readonly files: readonly BundleFile[];
}

const digest = /^[a-f0-9]{64}$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A relative path inside the bundle: no absolute path, no `..`, no backslash or empty segment. */
export function safeBundlePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Check a parsed manifest's shape; throws with the first problem. */
export function parseBundleManifest(value: unknown): BundleManifest {
  if (!isRecord(value) || value.format !== 1) throw new Error('Unsupported bundle format');
  for (const key of ['application', 'version', 'platform', 'createdAt'] as const)
    if (typeof value[key] !== 'string' || !value[key]) throw new Error(`Bundle ${key} is missing`);
  if (
    value.bestBefore !== undefined &&
    (typeof value.bestBefore !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.bestBefore))
  )
    throw new Error('Bundle best-before date is invalid');
  if (!Number.isInteger(value.storageSchema)) throw new Error('Bundle storage schema is missing');
  if (typeof value.catalogDigest !== 'string' || !digest.test(value.catalogDigest))
    throw new Error('Bundle catalog digest is invalid');
  const requirements = value.requirements;
  if (
    !isRecord(requirements) ||
    !Array.isArray(requirements.network) ||
    !Array.isArray(requirements.devices) ||
    !Array.isArray(requirements.processes)
  )
    throw new Error('Bundle requirements are invalid');
  if (!Array.isArray(value.files)) throw new Error('Bundle files are missing');
  const seen = new Set<string>();
  for (const file of value.files) {
    if (
      !isRecord(file) ||
      typeof file.path !== 'string' ||
      !safeBundlePath(file.path) ||
      typeof file.sha256 !== 'string' ||
      !digest.test(file.sha256) ||
      !Number.isSafeInteger(file.size)
    )
      throw new Error('Bundle file entry is invalid');
    if (seen.has(file.path)) throw new Error(`Bundle lists ${file.path} twice`);
    seen.add(file.path);
  }
  return value as unknown as BundleManifest;
}
