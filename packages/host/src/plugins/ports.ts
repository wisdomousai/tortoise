import type { IngressPort } from '@tortoise/kernel/plugin';
import { defaultPorts as kernelDefaults } from '@tortoise/kernel/plugins/ports';

export {
  isolatedNetwork,
  latePorts,
  noIngress,
  resolvePorts,
} from '@tortoise/kernel/plugins/ports';

/** Loopback only, on the requested port or an ephemeral one. The Bun platform's listener. */
export const loopbackIngress: IngressPort = Object.freeze({
  listen(port: number | undefined, handler: (request: Request) => Response | Promise<Response>) {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: port ?? 0,
      idleTimeout: 30,
      fetch: handler,
    });
    return { server, origin: `http://127.0.0.1:${server.port}` };
  },
});

/** The kernel's ports on Bun when no plugin provides them: no network, a loopback listener. */
export const defaultPorts = kernelDefaults(loopbackIngress);
