import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Share2 } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { useCSSVariable } from 'uniwind';
import type { OutputOf } from '@agent-native/contracts';
import { ListRow } from '@agent-native/frame-native/components/list-row';
import { StatusPill } from '@agent-native/frame-native/components/status-pill';
import { SyncPill, WorklistSync } from '@agent-native/frame-native/components/worklist-sync';
import { useOsAction } from '@agent-native/frame-native/os-actions';
import { useSession } from '@agent-native/frame-native/session';
import type { CaptureBody } from './brief';
import { fieldOperations as ops } from '../contracts';
import { captureSummary, refusal } from './os-requests';
import { Empty, ErrorText, Screen } from './shared';

const when = (at: number) => new Date(at).toLocaleString();
const titleOf = (body: unknown) => {
  const capture = body as CaptureBody;
  return capture.note || `${capture.kind}, ${capture.photos.length} photos`;
};
type Report = OutputOf<typeof ops.reportList>['items'][number];

/** A glove-sized button that shares a capture's summary as text. */
function ShareButton({ report, onError }: { report: Report; onError: (error: unknown) => void }) {
  const perform = useOsAction();
  const muted = useCSSVariable('--color-muted-foreground');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Share capture"
      onPress={() =>
        perform('capture.share', { text: captureSummary(report) }).then(
          (outcome) => onError(refusal('The capture was not shared', outcome)),
          onError,
        )
      }
      className="min-h-target min-w-target items-center justify-center rounded-xl active:bg-muted"
    >
      <Share2 size={24} color={typeof muted === 'string' ? muted : undefined} />
    </Pressable>
  );
}

/**
 * Captures taken without a node. The hub places them during review; the device keeps them as
 * sent. Each can be shared as text.
 */
export function UnplacedScreen() {
  const { live } = useSession();
  const reports = useQuery(live.liveQueryOptions(ops.reportList, {}));
  const [error, setError] = useState<unknown>();
  const unplaced = (reports.data?.items ?? []).filter((report) => report.subject === undefined);
  return (
    <Screen>
      <ErrorText error={reports.error ?? error} />
      <FlatList
        data={unplaced}
        keyExtractor={(report) => report.id}
        renderItem={({ item }) => (
          <ListRow
            title={titleOf(item.body)}
            detail={when(item.reportedAt)}
            trailing={
              <View className="flex-row items-center gap-2">
                <SyncPill sync={item.sync} issuer="the hub" />
                <ShareButton report={item} onError={setError} />
              </View>
            }
          />
        )}
        ListEmptyComponent={<Empty>No unplaced captures.</Empty>}
      />
    </Screen>
  );
}

/**
 * What the hub has taken: counts from the outbox and every capture with its state and a share
 * button. A refused capture shows the hub's reason; it stays on the device and is not sent again.
 */
export function SyncScreen() {
  const { live } = useSession();
  const status = useQuery(live.liveQueryOptions(ops.status, {}));
  const reports = useQuery(live.liveQueryOptions(ops.reportList, {}));
  const [error, setError] = useState<unknown>();
  const items = reports.data?.items ?? [];
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <Screen>
      <ErrorText error={status.error ?? reports.error ?? error} />
      <WorklistSync
        status={status.data}
        reports={items}
        issuer="the hub"
        title={(report) => titleOf(byId.get(report.id)?.body)}
        action={(report) => {
          const item = byId.get(report.id);
          return item ? <ShareButton report={item} onError={setError} /> : null;
        }}
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
