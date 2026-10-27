import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CapabilityForm } from '@/components/capability-form';
import { hostJson } from '@/lib/host-client';
import { live } from '@/lib/session';
import { resultOperations, type TestResult } from '../contracts';
import { resultAnalysisPaths, type AnalysisRun } from '../plugins/result-analysis/plugin-manifest';

type Availability = { available: true } | { available: false; reason: string };
const path = (route: string) => route.replace(/^\/api\/v1\//, '');

/** Why a run recorded nothing, from the JSON line the tool printed. */
function failure(run: AnalysisRun) {
  if (run.timedOut) return 'The analysis stopped at its time limit';
  const output = run.output as { step?: string; error?: { message?: string } } | undefined;
  return output?.error?.message ?? `The analysis tool exited with ${String(run.exitCode)}`;
}

function ResultRow({ result, availability }: { result: TestResult; availability?: Availability }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const analyze = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const run = await hostJson<AnalysisRun>(path(resultAnalysisPaths.run), {
        result: result.id,
      });
      if (run.exitCode !== 0) setError(failure(run));
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const { analysis } = result;
  return (
    <li className="space-y-2 rounded-lg border p-3 text-sm">
      <p>
        {result.readings.join(', ')} MPa, recorded by {result.recordedBy}
      </p>
      {analysis ? (
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">analyzed</Badge>
          <span>
            mean {analysis.mean} MPa, s {analysis.stdev}, range {analysis.min} to {analysis.max}, n{' '}
            {analysis.count}
          </span>
          <span className="text-muted-foreground">
            {result.analysisRun ? `computed in run ${result.analysisRun}` : 'entered by hand'}
          </span>
        </p>
      ) : null}
      <Button size="sm" disabled={busy || !availability?.available} onClick={() => void analyze()}>
        {analysis ? 'Analyze again in the sandbox' : 'Analyze in the sandbox'}
      </Button>
      {error ? <p className="text-destructive">{error}</p> : null}
      <details>
        <summary className="cursor-pointer text-muted-foreground">Enter statistics by hand</summary>
        <CapabilityForm
          capability={resultOperations.resultAnalyze}
          fixed={{ id: result.id }}
          submitLabel="Record statistics"
        />
      </details>
    </li>
  );
}

/**
 * Added below the base pattern's test request screen: the request's results, a form to record
 * readings, and the analysis, in the sandbox or by hand. Where the sandbox cannot run, the screen
 * says why and the button stays disabled.
 */
export function ResultsSection({ id }: { id: string }) {
  const results = useQuery(
    live.liveQueryOptions(resultOperations.resultList, { request: id } as never),
  );
  const status = useQuery({
    queryKey: ['result-analysis', 'status'],
    queryFn: () => hostJson<Availability>(path(resultAnalysisPaths.status)),
  });
  const items = (results.data as { items: TestResult[] } | undefined)?.items ?? [];
  const availability = status.data;
  return (
    <section aria-label="Test results" className="space-y-4">
      <h2 className="text-base font-medium">Test results</h2>
      {availability && !availability.available ? (
        <p className="rounded-lg border border-warning/60 p-3 text-sm">
          The analysis sandbox is unavailable here: {availability.reason}
        </p>
      ) : null}
      {items.length ? (
        <ul className="space-y-2">
          {items.map((result) => (
            <ResultRow key={result.id} result={result} availability={availability} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No readings recorded for this request.</p>
      )}
      <CapabilityForm
        capability={resultOperations.resultRecord}
        fixed={{ request: id }}
        submitLabel="Record readings"
      />
    </section>
  );
}
