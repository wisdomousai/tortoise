import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Share2 } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { useCSSVariable } from 'uniwind';
import type { OutputOf } from '@agent-native/contracts';
import { ListRow } from '@agent-native/frame-native/components/list-row';
import { StatusPill } from '@agent-native/frame-native/components/status-pill';
import { useOsAction } from '@agent-native/frame-native/os-actions';
import { useSession } from '@agent-native/frame-native/session';
import { fieldOperations as ops } from '../contracts';
import { captureSummary, refusal } from './os-requests';
import { Empty, ErrorText, Screen, SyncPill } from './shared';

const when = (at: number) => new Date(at).toLocaleString();
type Capture = OutputOf<typeof ops.captureList>['items'][number];

/** A capture's sync state, and a glove-sized button that shares its summary as text. */
function CaptureTrailing({
  capture,
  onError,
}: {
  capture: Capture;
  onError: (error: unknown) => void;
}) {
  const perform = useOsAction();
  const muted = useCSSVariable('--color-muted-foreground');
  return (
    <View className="flex-row items-center gap-2">
      <SyncPill sync={capture.sync} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share capture"
        onPress={() =>
          perform('capture.share', { text: captureSummary(capture) }).then(
            (outcome) => onError(refusal('The capture was not shared', outcome)),
            onError,
          )
        }
        className="min-h-target min-w-target items-center justify-center rounded-xl active:bg-muted"
      >
        <Share2 size={24} color={typeof muted === 'string' ? muted : undefined} />
      </Pressable>
    </View>
  );
}

/**
 * Captures taken without a node. The hub places them during review; the device keeps them as
 * sent. Each can be shared as text.
 */
export function UnplacedScreen() {
  const { live } = useSession();
  const captures = useQuery(live.liveQueryOptions(ops.captureList, { unplaced: true }));
  const [error, setError] = useState<unknown>();
  return (
    <Screen>
      <ErrorText error={captures.error ?? error} />
      <FlatList
        data={captures.data?.items ?? []}
        keyExtractor={(capture) => capture.id}
        renderItem={({ item }) => (
          <ListRow
            title={item.note || `${item.kind}, ${item.photos.length} photos`}
            detail={when(item.takenAt)}
            trailing={<CaptureTrailing capture={item} onError={setError} />}
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
  const [error, setError] = useState<unknown>();
  const counts = status.data;
  return (
    <Screen>
      <ErrorText error={status.error ?? captures.error ?? error} />
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
            trailing={<CaptureTrailing capture={item} onError={setError} />}
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
