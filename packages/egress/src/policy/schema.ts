import { z } from 'zod';

/**
 * Site policy: deployment data that binds declared destinations to real addresses and selects a
 * hardening profile. Code declares what it may need; only this file opens anything. Without a
 * policy the deployment is isolated (loopback only), which is the offline-first default.
 */
export const hardeningProfiles = ['desktop-local', 'sandbox', 'zero-trust'] as const;
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
  }),
]);
export const sitePolicySchema = z.strictObject({
  profile: z.enum(hardeningProfiles).default('desktop-local'),
  mode: z.enum(['isolated', 'connected']).default('isolated'),
  destinations: z.record(z.string(), bindingSchema).default({}),
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
       * `loopback`: 127.0.0.1, trusted local clients. `mtls`: a TLS listener that admits only
       * clients presenting a certificate from `clientCa`; sessions are still required on top.
       */
      listen: z.enum(['loopback', 'mtls']).default('loopback'),
      /** Name clients connect to; the listener binds it and checks the Host header against it. */
      host: z.string().optional(),
      port: z.number().int().min(0).max(65535).optional(),
      /** PEM paths, relative to the policy file. */
      cert: z.string().optional(),
      key: z.string().optional(),
      clientCa: z.string().optional(),
    })
    .default({ listen: 'loopback' }),
  grants: z.strictObject({ maxTtlSeconds: z.number().int().positive().optional() }).default({}),
});
export type SitePolicy = z.output<typeof sitePolicySchema>;
export type SitePolicyInput = z.input<typeof sitePolicySchema>;
