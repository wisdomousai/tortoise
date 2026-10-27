import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { client, live } from '@/lib/session';
import { chamberOperations, type Chamber, type Condition } from '../contracts';

const time = (at: number | null) => (at === null ? '' : new Date(at).toLocaleTimeString());

/** A quantity's last observed value, marked when the source no longer confirms it. */
function Reading({ condition, unit }: { condition: Condition | null; unit: string }) {
  if (!condition) return <span className="text-muted-foreground">No reading</span>;
  const value = condition.value === null ? 'No value' : `${condition.value.toFixed(1)} ${unit}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{value}</span>
      {condition.status === 'uncertain' && <Badge variant="outline">Uncertain</Badge>}
      {condition.since !== null && (
        <span className="text-xs text-muted-foreground">since {time(condition.since)}</span>
      )}
    </span>
  );
}

const target = (chamber: Chamber) =>
  `${chamber.setpoint.temperature} ± ${chamber.tolerance.temperature} °C, ${chamber.setpoint.humidity} ± ${chamber.tolerance.humidity} % RH`;

function Conditioned({ chamber }: { chamber: Chamber }) {
  return chamber.conditioned ? (
    <Badge>Conditioned</Badge>
  ) : (
    <Badge variant="destructive">Out of tolerance or unconfirmed</Badge>
  );
}

/** Every chamber with its live temperature and humidity. */
export function ChambersScreen() {
  const chambers = useQuery(live.liveQueryOptions(chamberOperations.chamberList, {}));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Climate chambers</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Chamber</TableHead>
            <TableHead>Temperature</TableHead>
            <TableHead>Humidity</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(chambers.data?.items ?? []).map((chamber) => (
            <TableRow key={chamber.id}>
              <TableCell>{chamber.label}</TableCell>
              <TableCell>
                <Reading condition={chamber.temperature} unit="°C" />
              </TableCell>
              <TableCell>
                <Reading condition={chamber.humidity} unit="% RH" />
              </TableCell>
              <TableCell>{target(chamber)}</TableCell>
              <TableCell>
                <Conditioned chamber={chamber} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Below one test request: the chamber that conditions its sample, and moving it to another. */
export function RequestChamber({ id }: { id: string }) {
  const conditions = useQuery(
    live.liveQueryOptions(chamberOperations.chamberConditions, { request: id }),
  );
  const chambers = useQuery(live.liveQueryOptions(chamberOperations.chamberList, {}));
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState<string>();
  const chamber = conditions.data?.chamber ?? null;
  const place = async () => {
    setMessage(undefined);
    try {
      await client.command(chamberOperations.chamberPlace, { request: id, chamber: selected });
    } catch (error) {
      setMessage(
        (error as { code?: string }).code === 'FORBIDDEN'
          ? 'Only technicians place samples.'
          : 'The sample was not placed.',
      );
    }
  };
  return (
    <section aria-label="Conditioning" className="space-y-3">
      <h2 className="text-lg font-semibold">Conditioning</h2>
      {chamber ? (
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Chamber</dt>
          <dd>{chamber.label}</dd>
          <dt className="text-muted-foreground">Temperature</dt>
          <dd>
            <Reading condition={chamber.temperature} unit="°C" />
          </dd>
          <dt className="text-muted-foreground">Humidity</dt>
          <dd>
            <Reading condition={chamber.humidity} unit="% RH" />
          </dd>
          <dt className="text-muted-foreground">Target</dt>
          <dd>{target(chamber)}</dd>
          <dt className="text-muted-foreground">State</dt>
          <dd>
            <Conditioned chamber={chamber} />
          </dd>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">The sample is in no chamber.</p>
      )}
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label="Chamber"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Choose a chamber</option>
          {(chambers.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </NativeSelect>
        <Button variant="outline" disabled={!selected} onClick={place}>
          Place in chamber
        </Button>
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}
