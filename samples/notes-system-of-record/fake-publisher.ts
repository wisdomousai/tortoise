/**
 * A notes publisher for the sample, on loopback. It publishes a note at once, or queues it for
 * moderation when `moderated` is set, refuses a note without text with 422, deduplicates on the
 * `Idempotency-Key` header, finds a publication by that key, and serves a change feed of notes
 * posted on its site. The `/control/*` routes act as the publisher's own staff would.
 */
export class FakePublisher {
  readonly publications = new Map<
    string,
    { id: string; state: 'review' | 'live'; body: unknown }
  >();
  private readonly posted: { seq: number; id: string; title: string; text: string }[] = [];
  private server?: ReturnType<typeof Bun.serve>;
  /** Queue new publications for review (202) instead of publishing them (201). */
  moderated = false;

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

  /** A moderator publishes a queued publication. */
  approve(key: string) {
    const publication = this.publications.get(key);
    if (publication) publication.state = 'live';
  }

  /** The publisher loses a publication it acknowledged, so its lookup answers 404. */
  forget(key: string) {
    this.publications.delete(key);
  }

  /** Someone posts a note on the publisher's site; the change feed reports it. */
  post(title: string, text: string) {
    const seq = this.posted.length + 1;
    this.posted.push({ seq, id: `p${seq}`, title, text });
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/publications') {
      const body = (await request.json()) as { text?: string };
      if (!body.text?.trim())
        return Response.json(
          { error: { code: 'EMPTY_NOTE', message: 'A note without text cannot be published' } },
          { status: 422 },
        );
      const key = request.headers.get('idempotency-key') ?? crypto.randomUUID();
      let publication = this.publications.get(key);
      if (!publication) {
        publication = {
          id: `pub-${this.publications.size + 1}`,
          state: this.moderated ? 'review' : 'live',
          body,
        };
        this.publications.set(key, publication);
      }
      return Response.json(
        { id: publication.id, state: publication.state },
        { status: publication.state === 'review' ? 202 : 201 },
      );
    }
    const byKey = /^\/publications\/by-key\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && byKey) {
      const publication = this.publications.get(decodeURIComponent(byKey[1]!));
      return publication
        ? Response.json({ id: publication.id, state: publication.state })
        : new Response('not found', { status: 404 });
    }
    if (request.method === 'GET' && url.pathname === '/changes') {
      const after = Number(url.searchParams.get('after') || 0);
      const page = this.posted.filter((note) => note.seq > after).slice(0, 20);
      const last = page.at(-1)?.seq ?? after;
      return Response.json({
        items: page.map(({ id, title, text }) => ({ id, title, text })),
        cursor: String(last),
        more: this.posted.some((note) => note.seq > last),
      });
    }
    const control = /^\/control\/(moderate|approve|forget|post)$/.exec(url.pathname);
    if (request.method === 'POST' && control) {
      const body = (await request.json().catch(() => ({}))) as Record<string, string | boolean>;
      if (control[1] === 'moderate') this.moderated = body.on === true;
      if (control[1] === 'approve') this.approve(String(body.key));
      if (control[1] === 'forget') this.forget(String(body.key));
      if (control[1] === 'post') this.post(String(body.title ?? ''), String(body.text ?? ''));
      return Response.json({ ok: true });
    }
    return new Response('not found', { status: 404 });
  }
}
