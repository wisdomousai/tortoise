import { useQuery } from '@tanstack/react-query';
import { WorklistList } from '@agent-native/frame-native/components/worklist-list';
import { useFrameNavigation } from '@agent-native/frame-native/frame';
import { useSession } from '@agent-native/frame-native/session';
import type { SurveyBrief } from './brief';
import { fieldOperations as ops } from '../contracts';
import { ErrorText, Screen } from './shared';

/** The surveys the hub sent this device, open ones first. */
export function AssignmentsScreen() {
  const { live } = useSession();
  const { open } = useFrameNavigation();
  const assignments = useQuery(live.liveQueryOptions(ops.assignmentList, {}));
  const items = assignments.data?.items ?? [];
  const brief = (id: string) => items.find((item) => item.id === id)?.brief as SurveyBrief;
  return (
    <Screen>
      <ErrorText error={assignments.error} />
      <WorklistList
        items={items}
        issuer="the hub"
        detail={(item) =>
          `${brief(item.id).nodes.length} nodes · ${item.reports} captures · ${brief(item.id).kinds.join(', ')}`
        }
        onOpen={(item) => open('/assignment', { assignmentId: item.id })}
        empty={
          assignments.isPending
            ? 'Loading…'
            : 'No surveys yet. They are received from the hub once this device is paired and sent one.'
        }
      />
    </Screen>
  );
}
