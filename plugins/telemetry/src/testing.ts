/** One OTLP/HTTP request the collector received: its path, such as `/v1/metrics`, and its body. */
export interface Received {
  readonly path: string;
  readonly body: Record<string, any>;
}

/** Requests the collector keeps; older ones are dropped, so a long development run stays small. */
const KEEP = 1_000;

/**
 * An OTLP/HTTP JSON collector on loopback that keeps the newest requests it receives, for tests
 * and development. Setting `control.down` makes it answer 503, as an unreachable collector would.
 * `port` defaults to a free one; a fixed port that is taken throws `EADDRINUSE`.
 */
export function startCollector(options: { port?: number } = {}) {
  const received: Received[] = [];
  const control = { down: false };
  const receive = async (request: Request) => {
    if (control.down) return new Response('unavailable', { status: 503 });
    received.push({
      path: new URL(request.url).pathname,
      body: (await request.json()) as Record<string, any>,
    });
    if (received.length > KEEP) received.splice(0, received.length - KEEP);
    return Response.json({});
  };
  const server = Bun.serve({ hostname: '127.0.0.1', port: options.port ?? 0, fetch: receive });
  return {
    url: `http://127.0.0.1:${server.port}`,
    received,
    control,
    stop: () => server.stop(true),
  };
}
