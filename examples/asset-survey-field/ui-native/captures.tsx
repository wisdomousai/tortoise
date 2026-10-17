import { FlatList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ListRow } from '@agent-native/frame-native/components/list-row';
import { StatusPill } from '@agent-native/frame-native/components/status-pill';
import { useSession } from '@agent-native/frame-native/session';
import { fieldOperations as ops } from '../contracts';
import { Empty, ErrorText, Screen, SyncPill } from './shared';

const when = (at: number) => new Date(at).toLocaleString();

/** Captures taken without a node. The hub places them during review; the device keeps them as sent. */
export function UnplacedScreen() {
  const { live } = useSession();
  const captures = useQuery(live.liveQueryOptions(ops.captureList, { unplaced: true }));
  return (
    <Screen>
      <ErrorText error={captures.error} />
      <FlatList
        data={captures.data?.items ?? []}
        keyExtractor={(capture) => capture.id}
        renderItem={({ item }) => (
          <ListRow
            title={item.note || `${item.kind}, ${item.photos.length} photos`}
            detail={when(item.takenAt)}
            trailing={<SyncPill sync={item.sync} />}
          />
        )}
        ListEmptyComponent={<Empty>No unplaced captures.</Empty>}
      />
    </Screen>
  );
}

/**
 * What the hub has taken: counts from the outbox and every capture with its state. A refused
 * capture shows the hub's reason; it stays on the device and is not sent again.
 */
export function SyncScreen() {
  const { live } = useSession();
  const status = useQuery(live.liveQueryOptions(ops.status, {}));
  const captures = useQuery(live.liveQueryOptions(ops.captureList, {}));
  const counts = status.data;
  return (
    <Screen>
      <ErrorText error={status.error ?? captures.error} />
      {counts ? (
        <View className="flex-row flex-wrap gap-2">
          <StatusPill
            signal={counts.pending ? 'pending' : 'idle'}
            label={`${counts.pending} waiting`}
          />
          <StatusPill signal="ok" label={`${counts.accepted} at the hub`} />
          <StatusPill
            signal={counts.rejected ? 'fault' : 'idle'}
            label={`${counts.rejected} refused`}
          />
        </View>
      ) : null}
      {counts?.lastSyncAt ? (
        <Text className="text-base text-muted-foreground">{`Assignments received ${when(counts.lastSyncAt)}`}</Text>
      ) : null}
      <FlatList
        data={captures.data?.items ?? []}
        keyExtractor={(capture) => capture.id}
        renderItem={({ item }) => (
          <ListRow
            title={item.note || `${item.kind}, ${item.photos.length} photos`}
            detail={
              item.rejection
                ? `${item.rejection.code}: ${item.rejection.message}`
                : when(item.takenAt)
            }
            trailing={<SyncPill sync={item.sync} />}
          />
        )}
        ListEmptyComponent={<Empty>No captures yet.</Empty>}
      />
    </Screen>
  );
}

/** The frame's status slot: how many records wait for the hub. */
export function FieldStatus() {
  const { live } = useSession();
  const status = useQuery(live.liveQueryOptions(ops.status, {})).data;
  if (!status?.pending && !status?.rejected) return null;
  return (
    <View className="flex-row gap-2 px-4 py-2">
      {status.pending ? (
        <StatusPill signal="pending" label={`${status.pending} waiting for the hub`} />
      ) : null}
      {status.rejected ? <StatusPill signal="fault" label={`${status.rejected} refused`} /> : null}
    </View>
  );
}
