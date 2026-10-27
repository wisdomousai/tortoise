import { randomUUID } from 'node:crypto';
import { ApplicationError, type OsDelivery, type OsHandlerKind } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import type { HostSession } from './http';

export interface PendingDelivery {
  readonly id: string;
  readonly delivery: OsDelivery;
  readonly expiresAt: number;
}
type Status = 'pending' | 'accepted' | 'rejected';
interface Inbox {
  principalId: string;
  workspaceId: string;
  items: Map<string, PendingDelivery & { status: Status }>;
}
export interface UiDeliveryPorts {
  isActive(token: string): boolean;
  /** Authorize a delivery for `context` (an opened resource must be readable); never write. */
  validate(context: ExecutionContext, delivery: OsDelivery): Promise<void>;
  now?: () => number;
  ttlMs?: number;
}

const handlerKinds: readonly OsHandlerKind[] = [
  'link',
  'file',
  'share',
  'intent',
  'shortcut',
  'reply',
];
const resourcePattern = /^[a-z][a-z0-9_-]*:[^\s:]{1,128}$/;
const pathPattern = /^\/(?:[A-Za-z0-9._~$-]+(?:\/[A-Za-z0-9._~$-]+)*)?$/;
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;

function validProvenance(value: unknown): boolean {
  return (
    plain(value) &&
    onlyKeys(value, ['kind', 'handler', 'label']) &&
    handlerKinds.includes(value.kind as OsHandlerKind) &&
    text(value.handler, 128) &&
    (value.label === undefined || text(value.label, 200))
  );
}

/** Shape of a delivery, checked before it is queued; the port authorizes it. */
export function validDelivery(value: unknown): value is OsDelivery {
  if (!plain(value) || !validProvenance(value.provenance)) return false;
  switch (value.type) {
    case 'openResource':
      return (
        onlyKeys(value, ['type', 'resource', 'provenance']) &&
        text(value.resource, 160) &&
        resourcePattern.test(value.resource as string)
      );
    case 'navigate':
      return (
        onlyKeys(value, ['type', 'to', 'search', 'provenance']) &&
        text(value.to, 256) &&
        pathPattern.test(value.to as string) &&
        (value.search === undefined ||
          (plain(value.search) &&
            Object.keys(value.search).length <= 16 &&
            Object.entries(value.search).every(
              ([key, item]) => key.length <= 64 && text(item, 2048),
            )))
      );
    case 'prepare':
      return (
        onlyKeys(value, ['type', 'operation', 'input', 'provenance']) &&
        text(value.operation, 128) &&
        plain(value.input) &&
        Object.keys(value.input).length <= 64 &&
        JSON.stringify(value.input).length <= 3 * 1_048_576
      );
    default:
      return false;
  }
}

/**
 * What OS requests asked the frame to show, held per host session until the frame takes them.
 * Like UI intents they are ephemeral and never write business records: a delivery opens a
 * screen or prefills a form that a person confirms. Only the session that submitted a request
 * receives its delivery, each is revalidated when taken, and each expires.
 */
export class UiDeliveryStore {
  private readonly inboxes = new Map<string, Inbox>();
  constructor(private readonly ports: UiDeliveryPorts) {}
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  private clean() {
    for (const [token, inbox] of this.inboxes) {
      if (!this.ports.isActive(token)) this.inboxes.delete(token);
      else
        for (const [id, item] of inbox.items)
          if (item.expiresAt <= this.now()) inbox.items.delete(id);
    }
  }
  private inbox(owner: HostSession, create: boolean): Inbox | undefined {
    if (owner.expiresAt <= this.now() || !this.ports.isActive(owner.token))
      throw new ApplicationError('FORBIDDEN', 'Active host session required');
    this.clean();
    let inbox = this.inboxes.get(owner.token);
    if (
      inbox &&
      (inbox.principalId !== owner.context.principalId ||
        inbox.workspaceId !== owner.context.workspaceId)
    )
      throw new ApplicationError('NOT_FOUND', 'Deliveries unavailable');
    if (!inbox && create) {
      if (this.inboxes.size >= 128)
        throw new ApplicationError('CONFLICT', 'Delivery capacity reached');
      inbox = {
        principalId: owner.context.principalId,
        workspaceId: owner.context.workspaceId,
        items: new Map(),
      };
      this.inboxes.set(owner.token, inbox);
    }
    return inbox;
  }
  /** Queue a delivery for `owner`'s frame. The oldest of more than 16 pending is dropped. */
  async send(owner: HostSession, delivery: OsDelivery): Promise<string> {
    const copied = structuredClone(delivery);
    if (!validDelivery(copied)) throw new ApplicationError('INVALID_INPUT', 'Invalid delivery');
    await this.ports.validate(owner.context, copied);
    const inbox = this.inbox(owner, true)!;
    const pending = [...inbox.items.values()].filter((item) => item.status === 'pending');
    if (pending.length >= 16) inbox.items.delete(pending[0]!.id);
    const id = randomUUID();
    inbox.items.set(id, {
      id,
      delivery: copied,
      status: 'pending',
      expiresAt: this.now() + (this.ports.ttlMs ?? 120_000),
    });
    return id;
  }
  /** Pending deliveries the caller may still see; one that no longer authorizes is rejected. */
  async poll(owner: HostSession): Promise<readonly PendingDelivery[]> {
    const inbox = this.inbox(owner, false);
    if (!inbox) return [];
    const result: PendingDelivery[] = [];
    for (const item of inbox.items.values()) {
      if (item.status !== 'pending') continue;
      try {
        await this.ports.validate(owner.context, structuredClone(item.delivery));
      } catch (error) {
        if (error instanceof ApplicationError && ['FORBIDDEN', 'NOT_FOUND'].includes(error.code)) {
          item.status = 'rejected';
          continue;
        }
        throw error;
      }
      const { status: _, ...value } = item;
      result.push(structuredClone(value));
    }
    return result;
  }
  acknowledge(owner: HostSession, id: string, status: 'accepted' | 'rejected'): void {
    const item = this.inbox(owner, false)?.items.get(id);
    if (!item) throw new ApplicationError('NOT_FOUND', 'Delivery unavailable');
    if (status !== 'accepted' && status !== 'rejected')
      throw new ApplicationError('INVALID_INPUT', 'Invalid delivery acknowledgement');
    if (item.status !== 'pending' && item.status !== status)
      throw new ApplicationError('CONFLICT', 'Delivery already completed');
    item.status = status;
  }
}
