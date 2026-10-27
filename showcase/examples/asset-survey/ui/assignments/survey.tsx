import { Link, useParams } from '@tanstack/react-router';
import { AssignmentReports, type AssignmentReport } from '@/components/assignment-reports';
import { RecordScreen } from '@/components/collection-screen';
import { operations, survey } from '../../contracts';
import type { Capture } from '../../domain';
import { blobUrl, when } from '../shared';

/** A survey report's photos, kind and note; the capture screen shows the rest. */
function CaptureSummary({ report }: { report: AssignmentReport }) {
  const body = report.body as Capture;
  return (
    <div className="flex gap-3 text-sm">
      {body.photos.slice(0, 3).map((photo) => (
        <img
          key={photo.digest}
          src={blobUrl(photo.digest)}
          alt={`Photo of the ${body.kind}`}
          className="size-20 rounded-md bg-muted object-cover"
        />
      ))}
      <span className="space-y-1">
        <span className="block font-medium">{body.kind}</span>
        <span className="block text-muted-foreground">{when(body.takenAt)}</span>
        {body.note && <span className="block">{body.note}</span>}
      </span>
    </div>
  );
}

/**
 * One survey and the captures reported on it. A capture is linked, read and accepted on its own
 * screen, where its photos sit beside the values; this list links there.
 */
export function SurveyScreen() {
  const { assignmentId } = useParams({ strict: false }) as { assignmentId: string };
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <RecordScreen title="Survey" get={operations.get} param="assignmentId" />
      <AssignmentReports
        title="Captures"
        list={operations.reportList}
        discard={operations.reportDiscard}
        input={{ assignmentId }}
        kinds={[
          {
            kind: survey,
            accept: operations.surveyAccept,
            body: (report) => <CaptureSummary report={report} />,
            review: (report) => (
              <Link
                to="/review/$captureId"
                params={{ captureId: report.id }}
                className="text-sm text-primary hover:underline"
              >
                Link, read and accept
              </Link>
            ),
          },
        ]}
      />
    </div>
  );
}

/** One reading as reported: the model or person who read it and every value with its source. */
export function ReadingScreen() {
  return (
    <div className="mx-auto max-w-5xl">
      <RecordScreen title="Reading" get={operations.reportGet} param="reportId" />
    </div>
  );
}
