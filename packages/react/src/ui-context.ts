export type UiIntent =
  | { type: 'openResource' | 'selectResource'; resource: string }
  | { type: 'requestReview'; title: string; operations: readonly string[] };
export interface UiContext {
  sessionId: string;
  selectedResources: readonly string[];
  observedRevisions: Readonly<Record<string, number>>;
}
/** UI context is an explicit immutable target snapshot, never ambient authority. */
export function captureUiContext(context: UiContext): UiContext {
  return structuredClone(context);
}

/** Host-independent session routing. No durable business writes occur through intents. */
export class UiSessions {
  private sessions = new Map<
    string,
    { context: UiContext; handle: (intent: UiIntent) => Promise<'accepted' | 'rejected'> }
  >();
  register(
    context: UiContext,
    handle: (intent: UiIntent) => Promise<'accepted' | 'rejected'>,
  ): () => void {
    const entry = { context: captureUiContext(context), handle };
    this.sessions.set(context.sessionId, entry);
    return () => {
      if (this.sessions.get(context.sessionId) === entry) this.sessions.delete(context.sessionId);
    };
  }
  capture(sessionId: string): UiContext | undefined {
    const entry = this.sessions.get(sessionId);
    return entry ? captureUiContext(entry.context) : undefined;
  }
  async send(
    sessionId: string,
    intent: UiIntent,
  ): Promise<'accepted' | 'rejected' | 'unavailable'> {
    return (await this.sessions.get(sessionId)?.handle(intent)) ?? 'unavailable';
  }
}
