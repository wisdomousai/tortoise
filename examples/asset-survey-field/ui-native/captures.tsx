import { FlatList, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ListRow } from '@agent-native/frame-native/components/list-row';
import { StatusPill } from '@agent-native/frame-native/components/status-pill';
import { SyncPill, WorklistSync } from '@agent-native/frame-native/components/worklist-sync';
import { useSession } from '@agent-native/frame-native/session';
import type { CaptureBody } from './brief';
import { fieldOperations as ops } from '../contracts';
import { Empty, ErrorText, Screen } from './shared';

const when = (at: number) => new Date(at).toLocaleString();
const titleOf = (body: unknown) => {
  const capture = body as CaptureBody;
  return capture.note || `${capture.kind}, ${capture.photos.length} photos`;
};

/** Captures taken without a node. The hub places them during review; the device keeps them as sent. */
export function UnplacedScreen() {
  const { live } = useSession();
  const reports = useQuery(live.liveQueryOptions(ops.reportList, {}));
  const unplaced = (reports.data?.items ?? []).filter((report) => report.subject === undefined);
  return (
    <Screen>
      <ErrorText error={reports.error} />
      <FlatList
        data={unplaced}
        keyExtractor={(report) => report.id}
        renderItem={({ item }) => (
          <ListRow
            title={titleOf(item.body)}
            detail={when(item.reportedAt)}
            trailing={<SyncPill sync={item.sync} issuer="the hub" />}
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
  const reports = useQuery(live.liveQueryOptions(ops.reportList, {}));
  const items = reports.data?.items ?? [];
  return (
    <Screen>
      <ErrorText error={status.error ?? reports.error} />
      <WorklistSync
        status={status.data}
        reports={items}
        issuer="the hub"
        title={(report) => titleOf(items.find((item) => item.id === report.id)?.body)}
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
