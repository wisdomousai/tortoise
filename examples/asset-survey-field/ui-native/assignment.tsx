import { useState } from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { HoldButton } from '@agent-native/frame-native/components/hold-button';
import { ListRow } from '@agent-native/frame-native/components/list-row';
import { useFrameNavigation } from '@agent-native/frame-native/frame';
import { useSession } from '@agent-native/frame-native/session';
import { matches, tree, type SurveyBrief } from './brief';
import { fieldOperations as ops } from '../contracts';
import { ActionButton, Empty, ErrorText, Screen, useScans } from './shared';

const field = 'min-h-target rounded-xl border border-border px-4 text-operator text-foreground';

/**
 * One survey's structure as a tree from its brief, with designation search. A scanned tag
 * searches the same way and opens the capture screen when it matches exactly one node. Marking
 * the survey done ends its field work on this device.
 */
export function AssignmentScreen() {
  const { assignmentId } = useRoute().params as { assignmentId: string };
  const { live, client } = useSession();
  const { open } = useFrameNavigation();
  const [q, setQ] = useState('');
  const [error, setError] = useState<unknown>();
  const assignment = useQuery(live.liveQueryOptions(ops.assignmentGet, { id: assignmentId }));
  const reports = useQuery(live.liveQueryOptions(ops.reportList, { assignmentId }));
  const brief = assignment.data?.brief as SurveyBrief | undefined;
  const counts = new Map<string, number>();
  for (const report of reports.data?.items ?? [])
    if (report.subject) counts.set(report.subject, (counts.get(report.subject) ?? 0) + 1);
  const nodes = tree(brief?.nodes ?? []).filter((node) => matches(node, q));
  const takes = assignment.data?.open === true;
  const capture = (nodeId?: string, codes: string[] = []) =>
    open('/capture', { assignmentId, ...(nodeId ? { nodeId } : {}), codes });

  useScans((scan) => {
    setQ(scan.data);
    const found = (brief?.nodes ?? []).filter((node) => matches(node, scan.data));
    if (takes && found.length === 1) capture(found[0]!.id, [scan.data]);
  });

  return (
    <Screen>
      {assignment.data?.note ? (
        <Text className="text-base text-muted-foreground">{assignment.data.note}</Text>
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
      <ErrorText error={assignment.error ?? error} />
      <FlatList
        data={nodes}
        keyExtractor={(node) => node.id}
        renderItem={({ item }) => (
          <View style={{ paddingLeft: q.trim() ? 0 : item.depth * 16 }}>
            <ListRow
              title={item.designation}
              detail={
                counts.get(item.id) ? `${item.name} · ${counts.get(item.id)} captured` : item.name
              }
              onPress={takes ? () => capture(item.id) : undefined}
            />
          </View>
        )}
        ListEmptyComponent={<Empty>{assignment.isPending ? 'Loading…' : 'No node matches.'}</Empty>}
      />
      {takes ? (
        <View className="gap-2">
          <ActionButton label="Capture without a node" onPress={() => capture()} />
          <HoldButton
            label="Mark survey done"
            holdingLabel="Keep holding to finish"
            onConfirm={() => {
              setError(undefined);
              client
                .command(
                  ops.complete,
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
