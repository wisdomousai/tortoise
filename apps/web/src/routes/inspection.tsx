import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { OutputOf } from '@agent-native/contracts';
import { operations } from '../../../../examples/quality-inspection/contracts';
import { CapabilityForm } from '@/components/capability-form';
import { LiveDataTable, type LiveColumn } from '@/components/live-data-table';
import { useScannerInput } from '@agent-native/react/capture';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { live } from '@/lib/session';

type Lot = OutputOf<typeof operations.lotList>['items'][number];
const PAGE = 25;

const columns: LiveColumn<Lot>[] = [
  {
    accessorKey: 'id',
    header: 'Lot',
    cell: (info) => <span className="font-mono">{info.getValue<string>()}</span>,
  },
  {
    id: 'material',
    header: 'Material',
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="font-medium">{row.original.materialText}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.material}
          {row.original.batch ? ` · ${row.original.batch}` : ''}
        </div>
      </div>
    ),
  },
  { accessorKey: 'plant', header: 'Plant' },
  {
    id: 'progress',
    header: 'Progress',
    cell: ({ row }) => (
      <div className="flex w-36 items-center gap-2">
        <Progress value={(100 * row.original.recorded) / Math.max(1, row.original.required)} />
        <span className="tabular text-xs text-muted-foreground">
          {row.original.recorded}/{row.original.required}
        </span>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        <Badge variant={row.original.status === 'open' ? 'secondary' : 'outline'}>
          {row.original.status}
        </Badge>
        {row.original.outOfTolerance > 0 && (
          <Badge variant="destructive">{row.original.outOfTolerance} out of tolerance</Badge>
        )}
        {row.original.rejectedSync > 0 && (
          <Badge variant="destructive">{row.original.rejectedSync} rejected</Badge>
        )}
        {row.original.pendingSync > 0 && (
          <Badge variant="outline" className="border-warning/50 text-warning">
            {row.original.pendingSync} pending
          </Badge>
        )}
      </div>
    ),
  },
];

const seconds = (ms: number | undefined) =>
  ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`;

/** Inspection lots at the operator's plants, plus the capture economics this interface produces. */
export function InspectionScreen() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'open' | 'decided' | 'closed' | ''>('open');
  const [offset, setOffset] = useState(0);
  const lots = useQuery(
    live.liveQueryOptions(operations.lotList, {
      offset,
      limit: PAGE,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(status ? { status } : {}),
    }),
  );
  const metrics = useQuery(live.liveQueryOptions(operations.metricsSummary, {}));
  // Scanning a lot label anywhere on this screen opens its capture station.
  useScannerInput({
    onScan: (code) => void navigate({ to: '/inspection/$lotId', params: { lotId: code } }),
  });
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-medium tracking-widest text-muted-foreground">
          QUALITY INSPECTION
        </p>
        <h1 className="text-2xl font-semibold">Inspection lots</h1>
        <p className="text-sm text-muted-foreground">
          Lots and specifications come from the quality system. Results recorded here are forwarded
          to it; scan a lot label to start capturing.
        </p>
      </header>
      {metrics.data && (
        <section aria-label="Capture metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            title="Human, per datapoint"
            value={seconds(metrics.data.human.medianMs)}
            detail={`${metrics.data.human.count} captured · p90 ${seconds(metrics.data.human.p90Ms)}`}
          />
          <Metric
            title="Agent, per datapoint"
            value={seconds(metrics.data.agent.medianMs)}
            detail={`${metrics.data.agent.count} captured · p90 ${seconds(metrics.data.agent.p90Ms)}`}
          />
          <Metric
            title="Quality system acceptance"
            value={seconds(metrics.data.forwarding.accepted.medianMs)}
            detail={`${metrics.data.forwarding.pending} pending · ${metrics.data.forwarding.rejected} rejected`}
          />
          <Metric
            title="Corrections"
            value={String(metrics.data.corrections)}
            detail={`${metrics.data.outOfTolerance} active out-of-tolerance results`}
          />
        </section>
      )}
      <Card>
        <CardHeader className="flex flex-wrap items-end gap-3">
          <Input
            aria-label="Search lots"
            placeholder="Lot, material or batch"
            className="max-w-xs"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
          />
          <NativeSelect
            aria-label="Lot status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setOffset(0);
            }}
          >
            <option value="open">Open</option>
            <option value="decided">Decided</option>
            <option value="closed">Closed</option>
            <option value="">All</option>
          </NativeSelect>
        </CardHeader>
        <CardContent>
          {lots.error && <p role="alert">{lots.error.message}</p>}
          <LiveDataTable
            columns={columns}
            rows={lots.data?.items ?? []}
            count={lots.data?.count ?? 0}
            offset={offset}
            limit={PAGE}
            onOffset={setOffset}
            rowLabel={(lot) => `Inspect lot ${lot.id}`}
            onRowOpen={(lot) =>
              void navigate({ to: '/inspection/$lotId', params: { lotId: lot.id } })
            }
            empty={lots.isPending ? 'Loading lots…' : 'No lots at your plants match.'}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Plant access</CardTitle>
          <CardDescription>
            Supervisors grant inspector, supervisor or viewer roles. Generated from the
            inspection.plant.set-member contract; the authority decides who may use it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CapabilityForm capability={operations.plantSetMember} submitLabel="Update plant role" />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="tabular text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}
