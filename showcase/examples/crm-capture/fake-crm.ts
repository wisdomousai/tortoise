import type { Effect, EffectOutcome, SourceRequest } from '@agent-native/runtime';
import {
  DeliveryFailure,
  type CallerCredentials,
  type PullBatch,
  type SearchAccess,
  type SearchPage,
  type SystemOfRecordPort,
} from '@agent-native/integration';
import { page } from './fake-crm/cursor';
import { crmUsers, demoSeed, type CrmAccountRecord, type CrmContactRecord } from './fake-crm/seed';

/** A followed account as the feed delivers it, in the application's field names. */
export interface CrmFeedItem {
  externalId: string;
  name: string;
  industry: string;
  city: string;
  region: string;
  owner: string;
}
/** Tokens are opaque to the application; only this fake knows whose they are. */
const SERVICE = 'service';

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => (clearTimeout(timer), reject(new DeliveryFailure('Search cancelled'))),
      { once: true },
    );
  });
const matches = (q: string, ...fields: string[]) =>
  !q || fields.some((field) => field.toLowerCase().includes(q.toLowerCase()));

/**
 * Deterministic in-memory CRM. Sharing: a CRM user sees the accounts they own and public ones;
 * the service account sees everything. Search runs as the CRM user behind the credential;
 * a follow request checks the requesting principal's own access; the feed delivers followed
 * accounts. Search returns pages of `PAGE_SIZE` (see `fake-crm/cursor`). `latencyMs` makes search slow and `unavailable` makes every call fail transiently.
 */
export class FakeCrm implements SystemOfRecordPort<CrmFeedItem, string> {
  latencyMs = 0;
  unavailable = false;
  private readonly accounts = new Map<string, CrmAccountRecord>();
  private readonly contacts: CrmContactRecord[];
  /** Principal → CRM user, as an administrator connected them. */
  private readonly logins = new Map<string, string>();
  /** Followed account → feed sequence of its latest change. */
  private readonly followed = new Map<string, number>();
  private readonly activities = new Map<string, string>();
  private sequence = 0;

  constructor(options: { logins?: Record<string, string> } = {}) {
    const seed = demoSeed();
    for (const account of seed.accounts) this.accounts.set(account.Id, account);
    this.contacts = seed.contacts;
    for (const [principal, user] of Object.entries(options.logins ?? {}))
      this.connect(principal, user);
  }

  /** Give a principal a CRM login (`ann` or `ben`). */
  connect(principalId: string, user: string) {
    if (!(user in crmUsers)) throw new Error(`Unknown CRM user ${user}`);
    this.logins.set(principalId, user);
  }

  /** The credential store a remote source uses; the service account is always available. */
  readonly credentials: CallerCredentials<string> = {
    forPrincipal: async (principalId) => this.logins.get(principalId),
    service: async () => SERVICE,
  };

  describe() {
    return { target: 'crm', idempotentDelivery: true };
  }

  private sees(user: string, account: CrmAccountRecord | undefined): account is CrmAccountRecord {
    return !!account && (user === SERVICE || account.Public || account.OwnerId === user);
  }
  private accountItem(account: CrmAccountRecord): CrmFeedItem {
    return {
      externalId: account.Id,
      name: account.Name,
      industry: account.Industry,
      city: account.BillingCity,
      region: account.Region__c,
      owner: crmUsers[account.OwnerId] ?? account.OwnerId,
    };
  }
  private contactItem(contact: CrmContactRecord, account: CrmAccountRecord) {
    return {
      externalId: contact.Id,
      name: contact.Name,
      title: contact.Title,
      email: contact.Email,
      accountId: account.Id,
      accountName: account.Name,
      region: account.Region__c,
    };
  }

  /** Pages of accounts or contacts the credential's CRM user may see; lookups are one record. */
  async search(
    request: SourceRequest,
    access: SearchAccess<string>,
    signal: AbortSignal,
  ): Promise<SearchPage> {
    await wait(this.latencyMs, signal);
    if (this.unavailable) throw new DeliveryFailure('The CRM is not reachable');
    const user = access.credential;
    const query = request.query as { q?: string; externalId?: string };
    const q = query.q ?? '';
    const accounts = [...this.accounts.values()].filter((account) => this.sees(user, account));
    switch (request.operation) {
      case 'crm.account.search':
        return page(
          request,
          user,
          accounts
            .filter((account) => matches(q, account.Name, account.BillingCity, account.Industry))
            .map((account) => this.accountItem(account)),
        );
      case 'crm.account.lookup':
        return {
          items: accounts
            .filter((account) => account.Id === query.externalId)
            .map((account) => this.accountItem(account)),
        };
      case 'crm.contact.search':
        return page(
          request,
          user,
          this.contactsFor(user, (contact) =>
            matches(q, contact.Name, contact.Title, contact.Email),
          ),
        );
      case 'crm.contact.lookup':
        return { items: this.contactsFor(user, (contact) => contact.Id === query.externalId) };
      default:
        return { items: [] };
    }
  }
  private contactsFor(user: string, keep: (contact: CrmContactRecord) => boolean) {
    return this.contacts.filter(keep).flatMap((contact) => {
      const account = this.accounts.get(contact.AccountId);
      return this.sees(user, account) ? [this.contactItem(contact, account)] : [];
    });
  }

  async deliver(effect: Readonly<Effect>): Promise<EffectOutcome> {
    if (this.unavailable) throw new DeliveryFailure('The CRM is not reachable');
    const payload = effect.payload as { externalId?: string; accountId?: string };
    if (effect.type === 'account.follow') {
      const account = this.accounts.get(payload.externalId ?? '');
      // The requester's own access decides; a principal without a CRM login gets the service view.
      if (!this.sees(this.logins.get(effect.principalId) ?? SERVICE, account))
        return {
          status: 'rejected',
          code: 'NOT_VISIBLE',
          message: 'Account not found or not shared with you',
        };
      if (!this.followed.has(account.Id)) this.followed.set(account.Id, ++this.sequence);
      return { status: 'accepted', externalRef: account.Id };
    }
    if (effect.type === 'activity.create') {
      if (!this.followed.has(payload.accountId ?? ''))
        return { status: 'rejected', code: 'NOT_FOLLOWED', message: 'Account is not followed' };
      // Idempotent by effect ID: a redelivery returns the activity created the first time.
      const ref =
        this.activities.get(effect.id) ?? `00T${String(this.activities.size + 1).padStart(4, '0')}`;
      this.activities.set(effect.id, ref);
      return { status: 'accepted', externalRef: ref };
    }
    return {
      status: 'rejected',
      code: 'UNSUPPORTED',
      message: `Unsupported request ${effect.type}`,
    };
  }

  /** Followed accounts changed after `cursor`, oldest first. */
  async pull(cursor: string | undefined): Promise<PullBatch<CrmFeedItem>> {
    if (this.unavailable) throw new DeliveryFailure('The CRM is not reachable');
    const after = Number(cursor ?? 0);
    const items = [...this.followed]
      .filter(([, sequence]) => sequence > after)
      .sort(([, a], [, b]) => a - b)
      .map(([id]) => this.accountItem(this.accounts.get(id)!));
    return { items, cursor: String(this.sequence) };
  }

  /** Demo and tests: someone changes an account in the CRM; followers receive it on the feed. */
  rename(externalId: string, name: string) {
    const account = this.accounts.get(externalId);
    if (!account) throw new Error(`Unknown account ${externalId}`);
    account.Name = name;
    if (this.followed.has(externalId)) this.followed.set(externalId, ++this.sequence);
  }

  /** Activities the CRM holds, by effect ID; for tests. */
  delivered() {
    return new Map(this.activities);
  }
}
