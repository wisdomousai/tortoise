import type { ReactNode } from 'react';
import { FlatList, Text, View } from 'react-native';
import { ListRow } from './list-row';
import { StatusPill, type Signal } from './status-pill';

type Sync = 'pending' | 'accepted' | 'rejected';

/** A report as a worklist's `report.list` returns it. */
export interface WorklistSyncReport {
  id: string;
  kind: string;
  reportedAt: number;
  sync: Sync;
  rejection?: { code: string; message: string };
}
/** A worklist target's status: deliveries waiting, taken and refused, and the last feed. */
export interface WorklistStatus {
  pending: number;
  accepted: number;
  rejected: number;
  lastSyncAt?: number;
}

const signal: Record<Sync, Signal> = { pending: 'pending', accepted: 'ok', rejected: 'fault' };
const when = (at: number) => new Date(at).toLocaleString();

/** One delivery state as a pill: waiting for, at, or refused by the issuer. */
export function SyncPill({ sync, issuer = 'the issuer' }: { sync: Sync; issuer?: string }) {
  const label = { pending: `Waiting for ${issuer}`, accepted: `At ${issuer}`, rejected: 'Refused' };
  return <StatusPill signal={signal[sync]} label={label[sync]} />;
}

/**
 * What the issuer has taken: the worklist target's counts, when assignments were last received, and
 * every report with its state. A refused report shows the issuer's reason; it stays here and is
 * not sent again. The screen reads the worklist's status and `report.list` and passes them in;
 * `action` adds a control next to each report's state, such as a share button.
 */
export function WorklistSync({
  status,
  reports,
  title = (report) => report.kind,
  issuer = 'the issuer',
  action,
}: {
  status: WorklistStatus | undefined;
  reports: readonly WorklistSyncReport[];
  title?: (report: WorklistSyncReport) => string;
  issuer?: string;
  action?: (report: WorklistSyncReport) => ReactNode;
}) {
  return (
    <View className="flex-1 gap-4">
      {status ? (
        <View className="flex-row flex-wrap gap-2">
          <StatusPill
            signal={status.pending ? 'pending' : 'idle'}
            label={`${status.pending} waiting`}
          />
          <StatusPill signal="ok" label={`${status.accepted} at ${issuer}`} />
          <StatusPill
            signal={status.rejected ? 'fault' : 'idle'}
            label={`${status.rejected} refused`}
          />
        </View>
      ) : null}
      {status?.lastSyncAt ? (
        <Text className="text-base text-muted-foreground">{`Assignments received ${when(status.lastSyncAt)}`}</Text>
      ) : null}
      <FlatList
        data={reports}
        keyExtractor={(report) => report.id}
        renderItem={({ item }) => (
          <ListRow
            title={title(item)}
            detail={
              item.rejection
                ? `${item.rejection.code}: ${item.rejection.message}`
                : when(item.reportedAt)
            }
            trailing={
              action ? (
                <View className="flex-row items-center gap-2">
                  <SyncPill sync={item.sync} issuer={issuer} />
                  {action(item)}
                </View>
              ) : (
                <SyncPill sync={item.sync} issuer={issuer} />
              )
            }
          />
        )}
        ListEmptyComponent={
          <Text className="text-operator text-muted-foreground">No reports yet.</Text>
        }
      />
    </View>
  );
}
