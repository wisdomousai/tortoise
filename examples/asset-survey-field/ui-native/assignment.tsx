import { useState } from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { HoldButton } from '@agent-native/frame-native/components/hold-button';
import { ListRow } from '@agent-native/frame-native/components/list-row';
import { useFrameNavigation } from '@agent-native/frame-native/frame';
import { useSession } from '@agent-native/frame-native/session';
import { fieldOperations as ops } from '../contracts';
import { ActionButton, Empty, ErrorText, Screen, useScans } from './shared';

const field = 'min-h-target rounded-xl border border-border px-4 text-operator text-foreground';

/**
 * One assignment's structure as a tree, with designation search. A scanned tag searches the
 * same way and opens the capture screen when it matches exactly one node. Returning the
 * assignment ends its field work on this device.
 */
export function AssignmentScreen() {
  const { assignmentId } = useRoute().params as { assignmentId: string };
  const { live, client } = useSession();
  const { open } = useFrameNavigation();
  const [q, setQ] = useState('');
  const [error, setError] = useState<unknown>();
  const assignments = useQuery(live.liveQueryOptions(ops.assignmentList, {}));
  const nodes = useQuery(
    live.liveQueryOptions(ops.nodeList, { assignmentId, ...(q.trim() ? { q: q.trim() } : {}) }),
  );
  const assignment = assignments.data?.items.find((item) => item.id === assignmentId);
  const capture = (nodeId?: string, codes: string[] = []) =>
    open('/capture', { assignmentId, ...(nodeId ? { nodeId } : {}), codes });

  useScans(async (scan) => {
    setQ(scan.data);
    const found = (await client.query(ops.nodeList, { assignmentId, q: scan.data })).data.items;
    if (found.length === 1) capture(found[0]!.id, [scan.data]);
  });

  return (
    <Screen>
      {assignment?.note ? (
        <Text className="text-base text-muted-foreground">{assignment.note}</Text>
      ) : null}
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Designation or name, or scan a tag"
        accessibilityLabel="Search nodes"
        autoCapitalize="characters"
        autoCorrect={false}
        className={field}
      />
      <ErrorText error={nodes.error ?? error} />
      <FlatList
        data={nodes.data?.items ?? []}
        keyExtractor={(node) => node.id}
        renderItem={({ item }) => (
          <View style={{ paddingLeft: q.trim() ? 0 : item.depth * 16 }}>
            <ListRow
              title={item.designation}
              detail={item.captures ? `${item.name} · ${item.captures} captured` : item.name}
              onPress={assignment?.returned ? undefined : () => capture(item.id)}
            />
          </View>
        )}
        ListEmptyComponent={<Empty>{nodes.isPending ? 'Loading…' : 'No node matches.'}</Empty>}
      />
      {assignment && !assignment.returned ? (
        <View className="gap-2">
          <ActionButton label="Capture without a node" onPress={() => capture()} />
          <HoldButton
            label="Return assignment"
            holdingLabel="Keep holding to return"
            onConfirm={() => {
              setError(undefined);
              client
                .command(
                  ops.assignmentReturn,
                  { id: assignmentId },
                  { idempotencyKey: crypto.randomUUID() },
                )
                .catch(setError);
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
