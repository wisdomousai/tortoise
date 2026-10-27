import { useQuery } from '@tanstack/react-query';
import { NativeSelect } from '@/components/ui/native-select';
import { live } from '@/lib/session';
import { operations } from '../../contracts';
import { when } from '../shared';

/** A reading's scope: one capture still to review, picked by node, kind and time taken. */
export function ReadingScopePicker({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const captures = useQuery(live.liveQueryOptions(operations.captureList, { review: 'new' }));
  const tree = useQuery(live.liveQueryOptions(operations.tree, {}));
  const designations = new Map((tree.data?.items ?? []).map((node) => [node.id, node.designation]));
  const reportId = (value as { reportId?: string } | undefined)?.reportId ?? '';
  return (
    <div className="space-y-1.5">
      <label htmlFor="reading-capture" className="text-sm font-medium">
        Capture
      </label>
      <NativeSelect
        id="reading-capture"
        value={reportId}
        onChange={(event) => onChange({ reportId: event.target.value })}
      >
        <option value="">Choose a capture</option>
        {(captures.data?.items ?? []).map((capture) => (
          <option key={capture.id} value={capture.id}>
            {capture.nodeId ? (designations.get(capture.nodeId) ?? 'Node') : 'Unplaced'} ·{' '}
            {capture.kind} · {when(capture.takenAt)}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
