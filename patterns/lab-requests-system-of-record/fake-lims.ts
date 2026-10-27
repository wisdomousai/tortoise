/**
 * An enterprise LIMS for the pattern, on loopback. It registers a test request at once, or queues
 * it for the lab manager's review when `reviewed` is set. It refuses a request without a test
 * method with 422, deduplicates on the `Idempotency-Key` header, finds a registration by that
 * key, and serves a change feed of requests registered at other sites. The `/control/*` routes
 * act as the LIMS's own staff would.
 */
export class FakeLims {
  readonly registrations = new Map<
    string,
    { id: string; state: 'review' | 'registered'; body: unknown }
  >();
  private readonly elsewhere: {
    seq: number;
    id: string;
    specimen: string;
    description: string;
    method: string;
  }[] = [];
  private server?: ReturnType<typeof Bun.serve>;
  /** Queue new requests for review (202) instead of registering them (201). */
  reviewed = false;

  /** Listen on loopback; `port` 0 picks a free one. Returns the base URL. */
  start(port = 0) {
    this.server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch: (request) => this.handle(request),
    });
    return `http://127.0.0.1:${this.server.port}`;
  }

  async stop() {
    await this.server?.stop(true);
  }

  /** The lab manager accepts a queued request. */
  approve(key: string) {
    const registration = this.registrations.get(key);
    if (registration) registration.state = 'registered';
  }

  /** The LIMS loses a registration it acknowledged, so its lookup returns 404. */
  forget(key: string) {
    this.registrations.delete(key);
  }

  /** Another site's front desk registers a request; the change feed reports it. */
  register(specimen: string, description: string, method: string) {
    const seq = this.elsewhere.length + 1;
    this.elsewhere.push({ seq, id: `r${seq}`, specimen, description, method });
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/requests') {
      const body = (await request.json()) as { method?: string };
      if (!body.method?.trim())
        return Response.json(
          {
            error: {
              code: 'NO_METHOD',
              message: 'A test request without a test method cannot be registered',
            },
          },
          { status: 422 },
        );
      const key = request.headers.get('idempotency-key') ?? crypto.randomUUID();
      let registration = this.registrations.get(key);
      if (!registration) {
        registration = {
          id: `LIMS-${this.registrations.size + 1}`,
          state: this.reviewed ? 'review' : 'registered',
          body,
        };
        this.registrations.set(key, registration);
      }
      return Response.json(
        { id: registration.id, state: registration.state },
        { status: registration.state === 'review' ? 202 : 201 },
      );
    }
    const byKey = /^\/requests\/by-key\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && byKey) {
      const registration = this.registrations.get(decodeURIComponent(byKey[1]!));
      return registration
        ? Response.json({ id: registration.id, state: registration.state })
        : new Response('not found', { status: 404 });
    }
    if (request.method === 'GET' && url.pathname === '/changes') {
      const after = Number(url.searchParams.get('after') || 0);
      const page = this.elsewhere.filter((item) => item.seq > after).slice(0, 20);
      const last = page.at(-1)?.seq ?? after;
      return Response.json({
        items: page.map(({ id, specimen, description, method }) => ({
          id,
          specimen,
          description,
          method,
        })),
        cursor: String(last),
        more: this.elsewhere.some((item) => item.seq > last),
      });
    }
    const control = /^\/control\/(review|approve|forget|register)$/.exec(url.pathname);
    if (request.method === 'POST' && control) {
      const body = (await request.json().catch(() => ({}))) as Record<string, string | boolean>;
      if (control[1] === 'review') this.reviewed = body.on === true;
      if (control[1] === 'approve') this.approve(String(body.key));
      if (control[1] === 'forget') this.forget(String(body.key));
      if (control[1] === 'register')
        this.register(
          String(body.specimen ?? ''),
          String(body.description ?? ''),
          String(body.method ?? ''),
        );
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  }
}
