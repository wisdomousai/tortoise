import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCapabilityForm } from '@tortoise/react/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { live, transport } from '@/lib/session';
import { operations } from '../contracts';
import type { Inquiry } from '../contracts/inquiry';
import { Pager } from './common';
import { InquiryRows } from './inquiry-rows';
import { useScreenRecords, useScreenSelection } from './screen-context';
import { inquiryRecord } from './screen-records';
import { SerialMatches, serialText } from './serial';

const PAGE = 50;
const statuses = ['open', 'quoted', 'closed'] as const;
type Status = (typeof statuses)[number];
const statusLabel: Record<Status, string> = { open: 'Open', quoted: 'Quoted', closed: 'Closed' };

/** How many inquiries have the status; the instance counts them before paging. */
function StatusCount({ status }: { status: Status }) {
  const query = useQuery(live.liveQueryOptions(operations.inquiryList, { status, limit: 1 }));
  if (!query.data) return null;
  return <span className="text-xs text-muted-foreground tabular">{query.data.total}</span>;
}

const blankCall = { caller: '', customerId: '', transformerSerial: '', subject: '' };

/**
 * Log a call as an open inquiry through `inquiry.create`. The serial field offers the
 * transformers that start with what the caller has read out; picking one fills the utility too.
 */
function LogCall() {
  const customers = useQuery(live.liveQueryOptions(operations.customerList, { limit: 100 }));
  const caller = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState('');
  const { form } = useCapabilityForm(transport, operations.inquiryCreate, {
    defaultValues: blankCall,
    toInput: (values) => ({
      caller: values.caller.trim(),
      customerId: values.customerId,
      subject: values.subject.trim(),
      ...(values.transformerSerial.trim()
        ? { transformerSerial: serialText(values.transformerSerial) }
        : {}),
    }),
    onCommitted: (receipt) => {
      setSaved(`Logged: ${receipt.result.subject}`);
      form.reset();
      caller.current?.focus();
    },
  });
  const text = (name: 'caller' | 'subject', label: string, placeholder: string) => (
    <form.Field name={name}>
      {(field) => (
        <div className="space-y-1">
          <Label htmlFor={`call-${name}`}>{label}</Label>
          <Input
            id={`call-${name}`}
            ref={name === 'caller' ? caller : undefined}
            placeholder={placeholder}
            value={field.state.value}
            aria-invalid={field.state.meta.errors.length > 0}
            onChange={(event) => field.handleChange(event.target.value)}
          />
          {field.state.meta.errors.length > 0 && (
            <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
          )}
        </div>
      )}
    </form.Field>
  );
  return (
    <Card size="sm" className="self-start">
      <CardHeader>
        <CardTitle>Log a call</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved('');
            void form.handleSubmit();
          }}
        >
          {text('caller', 'Caller', 'J. Weber')}
          <form.Field name="transformerSerial">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor="call-serial">Serial</Label>
                <Input
                  id="call-serial"
                  className="font-mono"
                  placeholder="TR-40417, or the first digits"
                  autoComplete="off"
                  value={field.state.value}
                  aria-invalid={field.state.meta.errors.length > 0}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
                )}
                <form.Subscribe selector={(state) => state.values.customerId}>
                  {(customerId) => (
                    <SerialMatches
                      text={field.state.value}
                      customerId={customerId}
                      onPick={(transformer) => {
                        form.setFieldValue('transformerSerial', transformer.serial);
                        form.setFieldValue('customerId', transformer.customerId);
                      }}
                    />
                  )}
                </form.Subscribe>
              </div>
            )}
          </form.Field>
          <form.Field name="customerId">
            {(field) => (
              <div className="space-y-1">
                <Label htmlFor="call-utility">Utility</Label>
                <NativeSelect
                  id="call-utility"
                  className="w-full"
                  value={field.state.value}
                  aria-invalid={field.state.meta.errors.length > 0}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="">Select…</option>
                  {customers.data?.items.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} ({customer.account})
                    </option>
                  ))}
                </NativeSelect>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
                )}
              </div>
            )}
          </form.Field>
          {text('subject', 'Subject', 'Two HV bushings after a flashover')}
          <div className="flex items-center gap-3">
            <Button type="submit">
              Log call{' '}
              <Kbd aria-hidden className="bg-primary-foreground/15 text-primary-foreground">
                ↵
              </Kbd>
            </Button>
            <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
              {(error) =>
                typeof error === 'string' ? (
                  <span role="alert" className="text-xs text-destructive">
                    {error}
                  </span>
                ) : (
                  <span role="status" className="truncate text-xs text-muted-foreground">
                    {saved}
                  </span>
                )
              }
            </form.Subscribe>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The desk's first screen: the calls it has to answer, and the form for the next call. The
 * assistant panel sees the calls the person selected on the page shown, and the assistant selects
 * a call on that page.
 */
function InquiriesScreen() {
  const [status, setStatus] = useState<Status>('open');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const text = search.trim();
  const list = useQuery(
    live.liveQueryOptions(operations.inquiryList, {
      status,
      offset,
      limit: PAGE,
      ...(text ? { search: text } : {}),
    }),
  );
  const page = list.data;
  // Only the selected calls the page shows now, so another tab, search or page drops the others.
  useScreenRecords(
    page?.items.filter((inquiry) => selected.has(inquiry.id)).map(inquiryRecord) ?? [],
  );
  const select = (inquiry: Inquiry, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(inquiry.id);
      else next.delete(inquiry.id);
      return next;
    });
  // The assistant selects a call the page shows, as the person's checkbox does.
  useScreenSelection((kind, id) => {
    const inquiry = page?.items.find((item) => item.id === id);
    if (kind !== 'inquiry' || !inquiry) return false;
    select(inquiry, true);
    return true;
  });
  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Inquiries</h1>
        <Tabs
          value={status}
          onValueChange={(value) => {
            setStatus(value as Status);
            setOffset(0);
          }}
        >
          <TabsList>
            {statuses.map((value) => (
              <TabsTrigger key={value} value={value} className="gap-1.5 px-2.5">
                {statusLabel[value]}
                <StatusCount status={value} />
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          aria-label="Search inquiries"
          placeholder="Caller, subject or serial"
          className="ml-auto h-8 w-64"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
      </header>
      <div className="grid items-start gap-4 @5xl/main:grid-cols-[minmax(0,1fr)_22rem]">
        <Card size="sm" className="gap-2 py-1">
          {page && page.items.length > 0 ? (
            <InquiryRows inquiries={page.items} selected={selected} onSelect={select} />
          ) : (
            <p className="px-3 py-6 text-sm text-muted-foreground">
              {list.isPending
                ? 'Loading inquiries…'
                : text
                  ? `No ${status} inquiry matches “${text}”.`
                  : `No ${status} inquiries.`}
            </p>
          )}
          {page && <Pager offset={offset} limit={PAGE} total={page.total} onOffset={setOffset} />}
        </Card>
        <LogCall />
      </div>
    </div>
  );
}

/** The Inquiries screen; a row opens the transformer the call is about. */
export const inquiryRoutes = [{ path: 'inquiries', component: () => <InquiriesScreen /> }];
