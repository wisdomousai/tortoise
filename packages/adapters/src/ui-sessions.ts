import { randomUUID } from 'node:crypto';
import { ApplicationError } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import type { HostSession } from './http';

export interface UiContextInput {
  readonly selectedResources: readonly string[];
  readonly observedRevisions: Readonly<Record<string, number>>;
}
export interface CapturedUiContext extends UiContextInput {
  readonly sessionId: string;
  readonly version: number;
}
export type UiIntent =
  | { readonly type: 'openResource' | 'selectResource'; readonly resource: string }
  | {
      readonly type: 'requestReview';
      readonly title: string;
      readonly operations: readonly string[];
    };
export type IntentStatus = 'pending' | 'accepted' | 'rejected' | 'expired';
export interface PendingUiIntent {
  readonly id: string;
  readonly intent: UiIntent;
  readonly expiresAt: number;
}
interface Entry {
  token: string;
  principalId: string;
  workspaceId: string;
  context: CapturedUiContext;
  expiresAt: number;
  intents: Map<string, PendingUiIntent & { status: IntentStatus }>;
}
export interface UiSessionPorts {
  /** Consult the live host registry, so revoking a credential also revokes UI routing. */
  isActive(token: string): boolean;
  /** Resolve selected IDs inside the authority and authorize their read queries. */
  validateContext(context: ExecutionContext, value: UiContextInput): Promise<void>;
  /** Authorize resource intents and validate referenced operation IDs; never mutate business data. */
  validateIntent(context: ExecutionContext, intent: UiIntent): Promise<void>;
  now?: () => number;
  sessionTtlMs?: number;
  intentTtlMs?: number;
}
function immutable(value: CapturedUiContext): CapturedUiContext {
  return Object.freeze({
    ...value,
    selectedResources: Object.freeze([...value.selectedResources]),
    observedRevisions: Object.freeze({ ...value.observedRevisions }),
  });
}
function validateShape(value: UiContextInput): void {
  if (
    !value ||
    Object.keys(value).some((key) => !['selectedResources', 'observedRevisions'].includes(key)) ||
    !Array.isArray(value.selectedResources) ||
    value.selectedResources.length > 100 ||
    !value.observedRevisions ||
    typeof value.observedRevisions !== 'object' ||
    Array.isArray(value.observedRevisions) ||
    Object.getPrototypeOf(value.observedRevisions) !== Object.prototype
  )
    throw new ApplicationError('INVALID_INPUT', 'Invalid UI context');
  if (
    new Set(value.selectedResources).size !== value.selectedResources.length ||
    value.selectedResources.some(
      (id) => typeof id !== 'string' || !/^[a-z][a-z0-9_-]*:[^\s:]{1,128}$/.test(id),
    )
  )
    throw new ApplicationError('INVALID_INPUT', 'Invalid selected resource');
  const observed = Object.entries(value.observedRevisions);
  if (
    observed.length !== value.selectedResources.length ||
    observed.some(
      ([id, revision]) =>
        !value.selectedResources.includes(id) || !Number.isSafeInteger(revision) || revision < 0,
    )
  )
    throw new ApplicationError(
      'INVALID_INPUT',
      'Every selected resource requires its observed revision',
    );
}

/** Ephemeral UI routing. IDs confer no authority; every access requires its original live host session. */
export class UiSessionStore {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly ports: UiSessionPorts) {}
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private active(owner: HostSession) {
    if (
      owner.expiresAt <= this.now() ||
      !this.ports.isActive(owner.token) ||
      owner.context.signal?.aborted
    )
      throw new ApplicationError('FORBIDDEN', 'Active UI host session required');
  }
  private clean() {
    const now = this.now();
    const ttl = this.ports.intentTtlMs ?? 60_000;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now || !this.ports.isActive(entry.token)) {
        this.entries.delete(id);
        continue;
      }
      for (const [intentId, message] of entry.intents) {
        if (message.expiresAt + ttl <= now) entry.intents.delete(intentId);
        else if (message.expiresAt <= now && message.status === 'pending')
          message.status = 'expired';
      }
    }
  }
  private entry(owner: HostSession, id: string): Entry {
    this.active(owner);
    this.clean();
    const entry = this.entries.get(id);
    if (
      !entry ||
      entry.token !== owner.token ||
      entry.principalId !== owner.context.principalId ||
      entry.workspaceId !== owner.context.workspaceId
    )
      throw new ApplicationError('NOT_FOUND', 'UI session unavailable');
    return entry;
  }
  async register(owner: HostSession, value: UiContextInput): Promise<CapturedUiContext> {
    this.active(owner);
    this.clean();
    validateShape(value);
    const copied = structuredClone(value);
    await this.ports.validateContext(owner.context, copied);
    this.active(owner);
    if (this.entries.size >= 128)
      throw new ApplicationError('CONFLICT', 'UI session capacity reached');
    const context = immutable({ ...copied, sessionId: randomUUID(), version: 1 });
    this.entries.set(context.sessionId, {
      token: owner.token,
      principalId: owner.context.principalId,
      workspaceId: owner.context.workspaceId,
      context,
      expiresAt: this.now() + (this.ports.sessionTtlMs ?? 300_000),
      intents: new Map(),
    });
    return context;
  }
  async update(
    owner: HostSession,
    id: string,
    value: UiContextInput,
    expectedVersion?: number,
  ): Promise<CapturedUiContext> {
    const entry = this.entry(owner, id);
    validateShape(value);
    const before = entry.context.version;
    if (expectedVersion !== undefined && expectedVersion !== before)
      throw new ApplicationError('CONFLICT', 'UI context changed');
    const copied = structuredClone(value);
    await this.ports.validateContext(owner.context, copied);
    if (this.entry(owner, id) !== entry || entry.context.version !== before)
      throw new ApplicationError('CONFLICT', 'UI context changed during validation');
    entry.context = immutable({ ...copied, sessionId: id, version: before + 1 });
    entry.expiresAt = this.now() + (this.ports.sessionTtlMs ?? 300_000);
    return entry.context;
  }
  async capture(owner: HostSession, id: string): Promise<CapturedUiContext> {
    const entry = this.entry(owner, id);
    const context = immutable(entry.context);
    await this.ports.validateContext(owner.context, context);
    if (this.entry(owner, id) !== entry || context.version !== entry.context.version)
      throw new ApplicationError('CONFLICT', 'UI target changed during capture');
    return context;
  }
  async send(owner: HostSession, id: string, intent: UiIntent): Promise<string> {
    const entry = this.entry(owner, id);
    const copied = structuredClone(intent);
    if (!copied || !['openResource', 'selectResource', 'requestReview'].includes(copied.type))
      throw new ApplicationError('INVALID_INPUT', 'Unknown UI intent');
    if (
      Object.keys(copied).some(
        (key) =>
          !(
            copied.type === 'requestReview' ? ['type', 'title', 'operations'] : ['type', 'resource']
          ).includes(key),
      )
    )
      throw new ApplicationError('INVALID_INPUT', 'Unknown UI intent field');
    if (
      copied.type === 'requestReview' &&
      (typeof copied.title !== 'string' ||
        copied.title.length > 1000 ||
        !Array.isArray(copied.operations) ||
        copied.operations.length > 100 ||
        copied.operations.some(
          (operation) => typeof operation !== 'string' || operation.length > 128,
        ))
    )
      throw new ApplicationError('INVALID_INPUT', 'Invalid review intent');
    if (
      copied.type !== 'requestReview' &&
      (typeof copied.resource !== 'string' ||
        !/^[a-z][a-z0-9_-]*:[^\s:]{1,128}$/.test(copied.resource))
    )
      throw new ApplicationError('INVALID_INPUT', 'Invalid resource intent');
    await this.ports.validateIntent(owner.context, copied);
    if (this.entry(owner, id) !== entry)
      throw new ApplicationError('NOT_FOUND', 'UI session unavailable');
    if (entry.intents.size >= 64)
      throw new ApplicationError('CONFLICT', 'UI intent capacity reached');
    const intentId = randomUUID();
    entry.intents.set(intentId, {
      id: intentId,
      intent: copied,
      status: 'pending',
      expiresAt: this.now() + (this.ports.intentTtlMs ?? 60_000),
    });
    return intentId;
  }
  async poll(owner: HostSession, id: string): Promise<readonly PendingUiIntent[]> {
    const entry = this.entry(owner, id);
    entry.expiresAt = this.now() + (this.ports.sessionTtlMs ?? 300_000);
    const result: PendingUiIntent[] = [];
    for (const message of entry.intents.values())
      if (message.status === 'pending') {
        try {
          await this.ports.validateIntent(owner.context, structuredClone(message.intent));
        } catch (error) {
          if (
            error instanceof ApplicationError &&
            ['FORBIDDEN', 'NOT_FOUND'].includes(error.code)
          ) {
            message.status = 'rejected';
            continue;
          }
          throw error;
        }
        if (this.entry(owner, id) !== entry)
          throw new ApplicationError('NOT_FOUND', 'UI session unavailable');
        if (message.status === 'pending') {
          const { status: _, ...value } = message;
          result.push(structuredClone(value));
        }
      }
    this.entry(owner, id);
    return result;
  }
  acknowledge(
    owner: HostSession,
    id: string,
    intentId: string,
    status: 'accepted' | 'rejected',
  ): IntentStatus {
    const entry = this.entry(owner, id);
    const message = entry.intents.get(intentId);
    if (!message) throw new ApplicationError('NOT_FOUND', 'UI intent unavailable');
    if (status !== 'accepted' && status !== 'rejected')
      throw new ApplicationError('INVALID_INPUT', 'Invalid UI acknowledgement');
    if (message.status !== 'pending' && message.status !== status)
      throw new ApplicationError('CONFLICT', 'UI intent already settled');
    message.status = status;
    return status;
  }
  status(owner: HostSession, id: string, intentId: string): IntentStatus | undefined {
    return this.entry(owner, id).intents.get(intentId)?.status;
  }
  remove(owner: HostSession, id: string): void {
    this.entry(owner, id);
    this.entries.delete(id);
  }
}
