import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { jsonResponse, readJsonBody } from '@agent-native/adapters/http';
import { ApplicationError, recordKeySchema, type Catalog } from '@agent-native/contracts';
import type { ExecutionHost } from '@agent-native/execution-host/run';
import { defineHostPlugin } from '@agent-native/host/plugin';
import { agentGrant, type ExecutionContext } from '@agent-native/runtime';
import { resultAnalyst } from '../../contracts';
import {
  ANALYSIS_SANDBOX,
  resultAnalysisPaths,
  resultAnalysisPluginManifest,
  type AnalysisRun,
} from './plugin-manifest';

const checkout = resolve(import.meta.dir, '../../../..');
const tools = resolve(import.meta.dir, '../../tools');
/**
 * What the sandbox sees read-only: the installed packages, the framework packages the tool
 * imports, and the tool's own directory. Not the whole checkout, because the workspaces of the
 * samples and examples under it hold their owners' connection files, and an owner's token acts
 * outside the run's grant.
 */
export const analysisReadOnly = [join(checkout, 'node_modules'), join(checkout, 'packages'), tools];

/**
 * Run the result analyst's tool on one test result. The run acts as `caller` narrowed to the
 * analyst's grant and to that one result, through a token the execution host issues for this run
 * only. Policy still decides every call the tool makes, so a viewer's run reads but records
 * nothing.
 */
export async function analyzeResult(
  sandboxes: ExecutionHost,
  catalog: Catalog,
  caller: ExecutionContext,
  id: string,
): Promise<AnalysisRun> {
  const runId = `analysis-${randomUUID()}`;
  const grant = agentGrant(catalog, resultAnalyst.id, caller, {
    now: Date.now(),
    runId,
    resources: [`test-result:${id}`],
  });
  const result = await sandboxes.run({
    sandbox: ANALYSIS_SANDBOX,
    command: ['bun', join(tools, 'analyze.ts'), id],
    context: { workspaceId: caller.workspaceId, principalId: caller.principalId, runId, grant },
    readOnly: analysisReadOnly,
    limits: { wallMs: 30_000 },
  });
  const line = result.stdout.trim().split('\n').at(-1);
  let output: unknown;
  try {
    output = line ? JSON.parse(line) : undefined;
  } catch {
    output = undefined;
  }
  return { runId, exitCode: result.exitCode, timedOut: result.timedOut, output };
}

/**
 * The result analysis plugin: two routes over the execution host's service. It runs no work of
 * its own and writes nothing; the sandboxed tool records the analysis through the application's
 * command, as the caller.
 */
export const resultAnalysisPlugin = defineHostPlugin({
  manifest: resultAnalysisPluginManifest,
  requires: ['execution-host'],
  async open(context) {
    const sandboxes = context.services['execution-host'] as ExecutionHost;
    return {
      async route(request, caller) {
        const { pathname } = new URL(request.url);
        if (pathname === resultAnalysisPaths.status && request.method === 'GET')
          return jsonResponse(sandboxes.availability(ANALYSIS_SANDBOX));
        if (pathname !== resultAnalysisPaths.run || request.method !== 'POST') return undefined;
        const id = recordKeySchema.safeParse((await readJsonBody(request)).result);
        if (!id.success) throw new ApplicationError('INVALID_INPUT', 'result must be a record key');
        return jsonResponse(await analyzeResult(sandboxes, context.catalog, caller, id.data));
      },
    };
  },
});
