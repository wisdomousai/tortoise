import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OutputOf } from '@agent-native/contracts';
import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { client, live, transport } from '@/lib/session';

type Plant = OutputOf<typeof operations.plantList>['items'][number];
type Role = Plant['role'];
const roles: { value: Role; label: string }[] = [
  { value: 'inspector', label: 'Inspector' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'viewer', label: 'Viewer' },
];
const seconds = (ms: number | undefined) =>
  ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`;

/**
 * The person's plants: how capture is going there and, for supervisors, who may inspect or
 * decide. Role changes go through plant.set-member, so the authority enforces who may grant
 * what (supervisors only, never their own role) whichever caller asks.
 */
export function PlantScreen() {
  const plants = useQuery(live.liveQueryOptions(operations.plantList, {}));
  const items = plants.data?.items ?? [];
  const title = items.length === 1 ? `Plant ${items[0]!.plant}` : 'Plants';
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How capture is going, and who may inspect or decide here.
        </p>
      </header>
      <CaptureMetrics />
      {plants.isPending && <p role="status">Loading plants…</p>}
      {plants.data && !items.length && (
        <p className="text-sm text-muted-foreground">You hold no plant role.</p>
      )}
      {items.map((plant) => (
        <People key={plant.plant} plant={plant} />
      ))}
    </div>
  );
}

function CaptureMetrics() {
  const metrics = useQuery(live.liveQueryOptions(operations.metricsSummary, {}));
  if (!metrics.data) return null;
  const data = metrics.data;
  return (
    <section aria-label="Capture metrics" className="space-y-3 rounded-2xl border bg-card p-5">
      <h2 className="text-base font-semibold">Capture at your plants</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          title="Time per value, people"
          value={seconds(data.human.medianMs)}
          detail={`${data.human.count} captured · p90 ${seconds(data.human.p90Ms)}`}
        />
        <Metric
          title="Time per value, agents"
          value={seconds(data.agent.medianMs)}
          detail={`${data.agent.count} captured · p90 ${seconds(data.agent.p90Ms)}`}
        />
        <Metric
          title="Until the quality system accepts"
          value={seconds(data.forwarding.accepted.medianMs)}
          detail={`${data.forwarding.pending} sending · ${data.forwarding.rejected} rejected`}
        />
        <Metric
          title="Corrections"
          value={String(data.corrections)}
          detail={`${data.outOfTolerance} results out of tolerance`}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Measured from when a sample came up to when its value was saved, on this installation.
      </p>
    </section>
  );
}

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-4">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 font-mono text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

/** Members of one plant. Only supervisors receive the member list, so others see their role. */
function People({ plant }: { plant: Plant }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string>();
  const setRole = async (principalId: string, role: Role | null) => {
    setPending(principalId);
    setError('');
    try {
      await client.command(operations.plantSetMember, { plant: plant.plant, principalId, role });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Role change failed');
    } finally {
      setPending(undefined);
    }
  };
  const members = Object.entries(plant.members ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <section aria-label={`People at ${plant.plant}`} className="rounded-2xl border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-semibold">People at {plant.plant}</h2>
        <p className="text-sm text-muted-foreground">
          {plant.members
            ? 'Roles apply everywhere: this screen, the command line and agents acting for someone.'
            : `You are ${plant.role} here. Supervisors manage who else has access.`}
        </p>
      </div>
      {plant.members && (
        <>
          <ul aria-label="Plant memberships" className="divide-y">
            {members.map(([principal, role]) => (
              <li key={principal} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase"
                >
                  {principal[0]}
                </span>
                <span className="min-w-0 flex-1 font-medium">{principal}</span>
                <Label htmlFor={`role-${principal}`} className="sr-only">
                  Role of {principal}
                </Label>
                <NativeSelect
                  id={`role-${principal}`}
                  value={role}
                  disabled={pending === principal}
                  onChange={(event) => void setRole(principal, event.target.value as Role)}
                >
                  {roles.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  variant="ghost"
                  aria-label={`Remove ${principal}`}
                  disabled={pending === principal}
                  onClick={() => void setRole(principal, null)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="px-5 pb-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <AddMember plant={plant.plant} />
        </>
      )}
    </section>
  );
}

function AddMember({ plant }: { plant: string }) {
  const [saved, setSaved] = useState('');
  const { form } = useCapabilityForm(transport, operations.plantSetMember, {
    defaultValues: { principalId: '', role: 'inspector' as Role },
    toInput: (values) => ({ plant, principalId: values.principalId.trim(), role: values.role }),
    onCommitted: () => {
      setSaved(`Added ${form.state.values.principalId.trim()}`);
      form.reset();
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t bg-muted/40 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="principalId">
        {(field) => (
          <div className="min-w-0 flex-[1_1_14rem] space-y-1">
            <Label htmlFor={`person-${plant}`}>Add a person</Label>
            <Input
              id={`person-${plant}`}
              placeholder="User ID"
              value={field.state.value}
              aria-invalid={field.state.meta.errors.length > 0}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </div>
        )}
      </form.Field>
      <form.Field name="role">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor={`new-role-${plant}`}>Role</Label>
            <NativeSelect
              id={`new-role-${plant}`}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as Role)}
            >
              {roles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </form.Field>
      <Button type="submit">Add</Button>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) =>
          typeof error === 'string' ? (
            <p role="alert" className="w-full text-sm text-destructive">
              {error}
            </p>
          ) : (
            <p role="status" className="w-full text-sm text-muted-foreground empty:hidden">
              {saved}
            </p>
          )
        }
      </form.Subscribe>
    </form>
  );
}
