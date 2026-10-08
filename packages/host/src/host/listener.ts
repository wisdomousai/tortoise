import type { Security } from '../security';

/**
 * Serve the handler where the site policy says. mTLS: the TLS layer admits only clients with a
 * certificate from the site's client CA; a session token is still required on every API call.
 * Otherwise loopback only.
 */
export function listen(
  security: Security,
  port: number | undefined,
  handler: (request: Request) => Response | Promise<Response>,
) {
  const ingress = security.policy.policy.ingress;
  const tls = security.policy.ingressTls;
  const server =
    ingress.listen === 'mtls' && tls
      ? Bun.serve({
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
        })
      : Bun.serve({
          hostname: '127.0.0.1',
          port: port ?? 0,
          idleTimeout: 30,
          fetch: handler,
        });
  const origin =
    ingress.listen === 'mtls'
      ? `https://${ingress.host}:${server.port}`
      : `http://127.0.0.1:${server.port}`;
  return { server, origin };
}
