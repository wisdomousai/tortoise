import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCommand } from '@agent-native/react';
import { deviceLinkOperations } from '@agent-native/device-link/contracts';
import { AssignmentBoard } from '@/components/assignment-board';
import { Button } from '@/components/ui/button';
import { live, transport } from '@/lib/session';
import { extraction, operations, survey } from '../contracts';
import { ReadingScopePicker } from './assignments/reading-scope';
import { SurveyScopeEditor } from './assignments/survey-scope';
import { ErrorText, Page, quietly } from './shared';

/**
 * Field work: plan a survey on subtrees of the structure and send it to a paired phone or a
 * person, then follow its captures back. A planner marks a survey done for a lost phone.
 * An extraction sends one capture to the model or to a person to read; a refused one is withdrawn here.
 */
export function AssignmentsScreen() {
  const devices = useQuery(live.liveQueryOptions(deviceLinkOperations.deviceList, {}));
  const people = useQuery(live.liveQueryOptions(operations.assigneeList, {}));
  const complete = useCommand(transport, operations.complete);
  const phones = (devices.data?.devices ?? []).filter(
    (device) => device.kind === 'field-sync' && device.revokedAt === undefined,
  );
  const assignees = [
    ...phones.map((phone) => ({ type: 'device', id: phone.id, label: phone.label })),
    ...(people.data?.items ?? []),
  ];
  return (
    <Page
      title="Assignments"
      description="A phone receives its surveys with the structure below them at its next sync, works offline, and hands captures back one by one."
      actions={
        phones.length === 0 && (
          <Link to="/devices" className="text-sm text-primary hover:underline">
            Pair a phone to send it surveys
          </Link>
        )
      }
    >
      <AssignmentBoard
        title="Surveys"
        list={operations.list}
        withdraw={operations.withdraw}
        close={operations.close}
        input={{ kind: 'survey' }}
        assignees={assignees}
        kinds={[
          {
            kind: survey,
            create: operations.surveyCreate,
            send: operations.surveySend,
            scope: (props) => <SurveyScopeEditor {...props} />,
          },
        ]}
        aside={(assignment) => (
          <>
            {assignment.assignee?.type === 'device' &&
              ['sent', 'working'].includes(assignment.stage) && (
                <Button
                  size="sm"
                  variant="outline"
                  title="For a lost phone: mark the field work done here"
                  disabled={complete.pending}
                  onClick={() => void quietly(complete.execute({ id: assignment.id }))}
                >
                  Mark done
                </Button>
              )}
            <Link
              to="/assignments/$assignmentId"
              params={{ assignmentId: assignment.id }}
              className="text-sm text-primary hover:underline"
            >
              Captures
            </Link>
          </>
        )}
      />
      <AssignmentBoard
        title="Extractions"
        list={operations.list}
        withdraw={operations.withdraw}
        close={operations.close}
        input={{ kind: 'extraction' }}
        assignees={assignees}
        kinds={[
          {
            kind: extraction,
            create: operations.extractionCreate,
            send: operations.extractionSend,
            scope: (props) => <ReadingScopePicker {...props} />,
          },
        ]}
        aside={(assignment) => (
          <Link
            to="/review/$captureId"
            params={{ captureId: (assignment.scope as { reportId: string }).reportId }}
            className="text-sm text-primary hover:underline"
          >
            Capture
          </Link>
        )}
      />
      <ErrorText error={complete.error} />
    </Page>
  );
}
