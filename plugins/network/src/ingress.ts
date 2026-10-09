import type { ResolvedPolicy } from '@agent-native/egress';
import type { IngressPort } from '@agent-native/host/plugin';

/**
 * The mutual TLS listener a site policy selects: the TLS layer admits only clients with a
 * certificate from the site's client CA; a session token is still required on every API call.
 * Undefined when the policy keeps the kernel's loopback listener.
 */
export function mtlsIngress(policy: ResolvedPolicy): IngressPort | undefined {
  const ingress = policy.policy.ingress;
  const tls = policy.ingressTls;
  if (ingress.listen !== 'mtls' || !tls) return undefined;
  return {
    listen(_port, handler) {
      const server = Bun.serve({
        hostname: ingress.host!,
        port: ingress.port!,
        idleTimeout: 30,
        tls: {
          cert: Bun.file(tls.cert),
          key: Bun.file(tls.key),
          ca: Bun.file(tls.clientCa),
          requestCert: true,
          rejectUnauthorized: true,
        },
        fetch: handler,
      });
      return { server, origin: `https://${ingress.host}:${server.port}` };
    },
  };
}
