import type { ResolvedPolicy } from '@agent-native/site/policy';
import type { IngressPort } from '@agent-native/host/plugin';

/**
 * The TLS listener a site policy selects, on the policy's host name and fixed port. With `mtls`
 * the TLS layer admits only clients with a certificate from the site's client CA; with `tls` any
 * client on the network reaches it. Either way every API call still needs a session or a
 * credential a plugin issued. Undefined when the policy keeps the kernel's loopback listener.
 */
export function policyIngress(policy: ResolvedPolicy): IngressPort | undefined {
  const ingress = policy.policy.ingress;
  const tls = policy.ingressTls;
  if (ingress.listen === 'loopback' || !tls) return undefined;
  const clientCa = ingress.listen === 'mtls' ? tls.clientCa : undefined;
  if (ingress.listen === 'mtls' && !clientCa) return undefined;
  return {
    listen(_port, handler) {
      const server = Bun.serve({
        hostname: ingress.host!,
        port: ingress.port!,
        idleTimeout: 30,
        tls: {
          cert: Bun.file(tls.cert),
          key: Bun.file(tls.key),
          ...(clientCa
            ? { ca: Bun.file(clientCa), requestCert: true, rejectUnauthorized: true }
            : {}),
        },
        fetch: handler,
      });
      return { server, origin: `https://${ingress.host}:${server.port}` };
    },
  };
}
