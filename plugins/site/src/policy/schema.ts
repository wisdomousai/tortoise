import { z } from 'zod';

/**
 * Site policy: deployment data that binds declared destinations to real addresses and selects a
 * hardening profile. Code declares what it may need; only this file opens anything. Without a
 * policy the deployment is isolated (loopback only), which is the offline-first default.
 */
/**
 * `desktop-local`: one person's machine, loopback only. `site-hub`: a machine on a site network
 * that paired devices reach over TLS, still run by its local owner. `sandbox`: an agent sandbox
 * driven by launcher grants. `zero-trust`: external identity, mutual TLS, forwarded audit.
 */
export const hardeningProfiles = ['desktop-local', 'site-hub', 'sandbox', 'zero-trust'] as const;
export type HardeningProfile = (typeof hardeningProfiles)[number];

const pin = z
  .string()
  .regex(
    /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/,
    'SHA-256 certificate fingerprint, colon-separated hex',
  );
const bindingSchema = z.union([
  z.strictObject({ disabled: z.literal(true), reason: z.string().max(500).optional() }),
  z.strictObject({
    /** Base URL (`https://mes.plant.local:8443/api`) or `tcp://host:port` for sockets. */
    url: z.string().min(1),
    /** Networks the host may resolve to. Required for firewall export and rebinding checks. */
    addresses: z.array(z.string()).optional(),
    /** PEM bundle path, relative to the policy file, replacing the default CA list. */
    ca: z.string().optional(),
    /** SHA-256 fingerprints of acceptable server certificates. */
    certificatePins: z.array(pin).optional(),
    /** Wrap a `tcp` destination in TLS. */
    tls: z.boolean().optional(),
    /**
     * Per-request timeout in milliseconds, replacing the guard's default of 30 s, for a
     * destination that answers slowly by nature, such as a local model server that reasons
     * before it replies.
     */
    timeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
  }),
]);
/** An environment variable name, as a process binding sets it. */
const variable = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, 'Upper-case environment variable name');
/**
 * Where a declared child process comes from on this site. Paths are absolute: a site names the
 * installed executable, never a name looked up on `PATH`. Values in `env` are configuration and
 * appear in reports; secrets come from the secret store under the names the process declares.
 */
const processBindingSchema = z.union([
  z.strictObject({ disabled: z.literal(true), reason: z.string().max(500).optional() }),
  z.strictObject({
    executable: z.string().min(1),
    /** Fixed leading arguments, before any the caller adds. */
    args: z.array(z.string().max(4096)).max(64).default([]),
    /** Working directory; the executable's directory when absent. */
    cwd: z.string().min(1).optional(),
    /** SHA-256 of the executable file, checked before every start. */
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'Lower-case hex SHA-256')
      .optional(),
    env: z.record(variable, z.string().max(4096)).default({}),
  }),
]);
export type ProcessBinding = z.output<typeof processBindingSchema>;
/** The directory a declared exchange folder means on this site; an absolute path. */
const folderBindingSchema = z.union([
  z.strictObject({ disabled: z.literal(true), reason: z.string().max(500).optional() }),
  z.strictObject({ path: z.string().min(1).max(4096) }),
]);
export const sitePolicySchema = z.strictObject({
  profile: z.enum(hardeningProfiles).default('desktop-local'),
  mode: z.enum(['isolated', 'connected']).default('isolated'),
  destinations: z.record(z.string(), bindingSchema).default({}),
  processes: z.record(z.string(), processBindingSchema).default({}),
  // Optional with no default, so a policy without folders keeps the digest it had before folders existed.
  folders: z.record(z.string(), folderBindingSchema).optional(),
  audit: z
    .strictObject({
      mode: z.enum(['fail-closed', 'best-effort']).default('fail-closed'),
      /** A bound destination that receives forwarded events (RFC 5424 over TLS). */
      forwardTo: z.string().optional(),
    })
    .default({ mode: 'fail-closed' }),
  identity: z.enum(['local-owner', 'grant-file', 'external']).default('local-owner'),
  ingress: z
    .strictObject({
      /**
       * `loopback`: 127.0.0.1, trusted local clients. `tls`: a TLS listener any client on the
       * network can reach; every API call needs a session or a credential a plugin issued, such
       * as a paired device's token. `mtls`: a TLS listener that admits only clients presenting a
       * certificate from `clientCa`; sessions are still required on top.
       */
      listen: z.enum(['loopback', 'tls', 'mtls']).default('loopback'),
      /** Name clients connect to; the listener binds it and checks the Host header against it. */
      host: z.string().optional(),
      port: z.number().int().min(0).max(65535).optional(),
      /** PEM paths, relative to the policy file. `clientCa` applies to `mtls` only. */
      cert: z.string().optional(),
      key: z.string().optional(),
      clientCa: z.string().optional(),
    })
    .default({ listen: 'loopback' }),
  grants: z.strictObject({ maxTtlSeconds: z.number().int().positive().optional() }).default({}),
  /**
   * The workforce identity provider that `identity: external` signs people in with: OpenID
   * Connect, authorization code with PKCE, as a public client. `issuer` must be on the origin
   * bound to the site plugin's `workforce-idp` destination, through which discovery, keys and
   * tokens are fetched.
   */
  workforce: z
    .strictObject({
      issuer: z.url(),
      clientId: z.string().min(1),
      /** The verified ID-token claim that becomes the principal ID. */
      principalClaim: z.string().min(1).default('email'),
      scopes: z.array(z.string().min(1)).default(['openid', 'email', 'profile']),
      sessionMinutes: z.number().int().positive().max(1440).default(480),
    })
    .optional(),
});
export type SitePolicy = z.output<typeof sitePolicySchema>;
export type SitePolicyInput = z.input<typeof sitePolicySchema>;
