/**
 * A REST system of record for tests: it deduplicates on the idempotency header, or keys a
 * record by the client reference in its `ref` field when the header is absent, refuses records
 * without a `sku` with 422, finds a record by its key, and serves a change list. It listens on
 * loopback only; reach it through a network port bound to its origin.
 */
export class FakeRestSystem {
  readonly records = new Map<string, { id: string; key: string; body: unknown }>();
  /** Requests that created a record, per idempotency key. */
  readonly applied = new Map<string, number>();
  private readonly changes: { seq: number; id: string }[] = [];
  private server?: ReturnType<typeof Bun.serve>;
  /** Fail the next request with this status before applying anything. */
  failNext?: number;

  start() {
    this.server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => this.handle(request),
    });
    return `http://127.0.0.1:${this.server.port}`;
  }

  async stop() {
    await this.server?.stop(true);
  }

  /** Make one record appear in inbound sync, as if another user created it. */
  change() {
    const id = `ext-${this.changes.length + 1}`;
    this.changes.push({ seq: this.changes.length + 1, id });
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (this.failNext) {
      const status = this.failNext;
      delete this.failNext;
      return new Response('unavailable', { status });
    }
    if (request.method === 'POST' && url.pathname === '/orders') {
      const body = (await request.json()) as { sku?: string; ref?: string };
      const key = request.headers.get('idempotency-key') ?? body.ref ?? crypto.randomUUID();
      if (!body.sku)
        return Response.json(
          { error: { code: 'NO_SKU', detail: 'Every line needs a SKU' } },
          { status: 422 },
        );
      let record = request.headers.has('idempotency-key') ? this.records.get(key) : undefined;
      if (!record) {
        record = { id: `ORD-${this.records.size + 1}`, key, body };
        this.records.set(key, record);
        this.applied.set(key, (this.applied.get(key) ?? 0) + 1);
      }
      return Response.json({ id: record.id }, { status: 201 });
    }
    const byKey = /^\/orders\/by-key\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && byKey) {
      const record = this.records.get(decodeURIComponent(byKey[1]!));
      return record ? Response.json({ id: record.id }) : new Response('not found', { status: 404 });
    }
    if (request.method === 'GET' && url.pathname === '/changes') {
      const after = Number(url.searchParams.get('after') ?? 0);
      const page = this.changes.filter((change) => change.seq > after).slice(0, 2);
      const last = page.at(-1)?.seq ?? after;
      return Response.json({
        data: page,
        next: String(last),
        hasMore: this.changes.some((change) => change.seq > last),
      });
    }
    return new Response('not found', { status: 404 });
  }
}
