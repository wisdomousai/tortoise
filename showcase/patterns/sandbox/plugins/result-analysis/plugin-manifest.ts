import { definePluginManifest } from '@agent-native/host/plugin-manifest';

/** The routes the request screen calls. Both act as the signed-in caller. */
export const resultAnalysisPaths = {
  /** GET: whether the analysis sandbox can run here, and why not. */
  status: '/api/v1/result-analysis/status',
  /** POST `{ result }`: run the result analyst on one test result and return what it recorded. */
  run: '/api/v1/result-analysis/run',
} as const;

/** What the run route returns: the run, how the tool exited and the JSON line it printed. */
export interface AnalysisRun {
  readonly runId: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly output?: unknown;
}

/** The sandbox process the analysis runs in, declared by the manifest's `executionSandbox`. */
export const ANALYSIS_SANDBOX = 'analysis-tools';

/**
 * The browser-safe part of the result analysis plugin. It declares nothing: the sandbox is the
 * application's component, and the plugin writes no records itself.
 */
export const resultAnalysisPluginManifest = definePluginManifest({
  id: 'result-analysis',
  title: 'Result analysis',
});
