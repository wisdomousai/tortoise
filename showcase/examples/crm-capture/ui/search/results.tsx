import type { ReactNode } from 'react';
import type { OutputOf } from '@tortoise/contracts';
import { crmAccounts, crmContacts } from '../../contracts';
import type { LocalStatus } from '../local-status';
import { FollowButton } from './follow-button';

type AccountFound = OutputOf<typeof crmAccounts.search>['items'][number];
type ContactFound = OutputOf<typeof crmContacts.search>['items'][number];
type Overlay = (accountId: string, fallback: LocalStatus) => LocalStatus;

function Row({ title, detail, action }: { title: string; detail: string; action: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {action}
    </li>
  );
}

const empty = (
  <p className="px-4 py-6 text-sm text-muted-foreground">No matches you can see in the CRM.</p>
);

export function AccountResults({ items, status }: { items: AccountFound[]; status: Overlay }) {
  if (!items.length) return empty;
  return (
    <ul aria-label="CRM accounts" className="divide-y">
      {items.map((account) => (
        <Row
          key={account.externalId}
          title={account.name}
          detail={`${account.industry} · ${account.city} · ${account.region} · owner ${account.owner}`}
          action={
            <FollowButton
              externalId={account.externalId}
              name={account.name}
              status={status(account.externalId, account.local)}
            />
          }
        />
      ))}
    </ul>
  );
}

export function ContactResults({ items, status }: { items: ContactFound[]; status: Overlay }) {
  if (!items.length) return empty;
  return (
    <ul aria-label="CRM contacts" className="divide-y">
      {items.map((contact) => (
        <Row
          key={contact.externalId}
          title={`${contact.name} · ${contact.title}`}
          detail={`${contact.accountName} · ${contact.email}`}
          action={
            <FollowButton
              externalId={contact.accountId}
              name={contact.accountName}
              status={status(contact.accountId, contact.local)}
            />
          }
        />
      ))}
    </ul>
  );
}
