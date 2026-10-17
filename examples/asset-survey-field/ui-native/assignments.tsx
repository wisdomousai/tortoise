import { FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ListRow } from '@agent-native/frame-native/components/list-row';
import { StatusPill } from '@agent-native/frame-native/components/status-pill';
import { useFrameNavigation } from '@agent-native/frame-native/frame';
import { useSession } from '@agent-native/frame-native/session';
import { fieldOperations as ops } from '../contracts';
import { Empty, ErrorText, Screen } from './shared';

/** The assignments the hub dispatched to this device, open ones first. */
export function AssignmentsScreen() {
  const { live } = useSession();
  const { open } = useFrameNavigation();
  const assignments = useQuery(live.liveQueryOptions(ops.assignmentList, {}));
  const items = [...(assignments.data?.items ?? [])].sort(
    (a, b) => Number(a.returned) - Number(b.returned),
  );
  return (
    <Screen>
      <ErrorText error={assignments.error} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ListRow
            title={item.title}
            detail={`${item.nodes} nodes · ${item.captures} captures · ${item.kinds.join(', ')}`}
            trailing={
              item.returned ? (
                <StatusPill
                  signal={item.returnSync === 'pending' ? 'pending' : 'idle'}
                  label="Returned"
                />
              ) : undefined
            }
            onPress={() => open('/assignment', { assignmentId: item.id })}
          />
        )}
        ListEmptyComponent={
          <Empty>
            {assignments.isPending
              ? 'Loading…'
              : 'No assignments yet. They arrive from the hub once this device is paired and dispatched.'}
          </Empty>
        }
      />
    </Screen>
  );
}
