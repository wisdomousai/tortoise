import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCommand } from '@agent-native/react';
import { deviceLinkOperations } from '@agent-native/device-link/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { live, transport } from '@/lib/session';
import { operations } from '../contracts';
import { AssignmentForm } from './assignments/assignment-form';
import { Empty, ErrorText, Page, quietly, when } from './shared';

const stageText: Record<string, string> = {
  draft: 'Draft',
  dispatched: 'Sent to device',
  'in-field': 'Captures arriving',
  returned: 'Back from the field',
  processed: 'Reviewed',
  filed: 'Filed',
};

/** Field work: plan it on subtrees of the structure, send it to a paired phone, follow it back. */
export function AssignmentsScreen() {
  const assignments = useQuery(live.liveQueryOptions(operations.assignmentList, {}));
  const devices = useQuery(live.liveQueryOptions(deviceLinkOperations.deviceList, {}));
  const dispatch = useCommand(transport, operations.assignmentDispatch);
  const giveBack = useCommand(transport, operations.assignmentReturn);
  const phones = (devices.data?.devices ?? []).filter(
    (device) => device.kind === 'field-sync' && device.revokedAt === undefined,
  );
  return (
    <Page
      title="Assignments"
      description="A phone receives its assignments with the structure below them at its next sync, works offline, and hands captures back."
    >
      <AssignmentForm />
      <ErrorText error={assignments.error?.message ?? dispatch.error ?? giveBack.error} />
      {assignments.data?.items.length === 0 && <Empty>No assignments yet.</Empty>}
      <ul aria-label="Assignments" className="divide-y rounded-xl border bg-card">
        {(assignments.data?.items ?? []).map((assignment) => (
          <li
            key={assignment.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="font-medium">{assignment.title}</p>
              <p className="text-sm text-muted-foreground">
                {assignment.kinds.join(', ')} · {assignment.captures} captures · created{' '}
                {when(assignment.createdAt)}
                {assignment.deviceId &&
                  ` · device ${phones.find((phone) => phone.id === assignment.deviceId)?.label ?? assignment.deviceId}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={assignment.stage === 'filed' ? 'secondary' : 'outline'}>
                {stageText[assignment.stage]}
              </Badge>
              {assignment.stage === 'draft' &&
                (phones.length ? (
                  <NativeSelect
                    aria-label={`Send ${assignment.title} to`}
                    value=""
                    disabled={dispatch.pending}
                    onChange={(event) =>
                      void quietly(
                        dispatch.execute({ id: assignment.id, deviceId: event.target.value }),
                      )
                    }
                  >
                    <option value="">Send to…</option>
                    {phones.map((phone) => (
                      <option key={phone.id} value={phone.id}>
                        {phone.label}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Link to="/devices" className="text-sm text-primary hover:underline">
                    Pair a phone to send it
                  </Link>
                ))}
              {(assignment.stage === 'dispatched' || assignment.stage === 'in-field') && (
                <Button
                  size="sm"
                  variant="outline"
                  title="For a lost device: mark the field work done here"
                  disabled={giveBack.pending}
                  onClick={() => void quietly(giveBack.execute({ id: assignment.id }))}
                >
                  Mark returned
                </Button>
              )}
              {assignment.captures > 0 && (
                <Link to="/review" className="text-sm text-primary hover:underline">
                  Review
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Page>
  );
}
