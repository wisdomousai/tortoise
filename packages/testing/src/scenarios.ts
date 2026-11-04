import { canonicalJson } from '@tortoise/contracts';
import type { CommandReceipt, ExecutionContext, Invocation, QueryResult } from '@tortoise/runtime';

/** Transport drivers implement this interface so the same business scenario runs everywhere. */
export interface ScenarioDriver {
  command(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
  query(request: Invocation, context: ExecutionContext): Promise<QueryResult>;
}
export interface BehavioralScenario {
  readonly name: string;
  run(driver: ScenarioDriver): Promise<void>;
}
export function directDriver(application: {
  invokeRaw: ScenarioDriver['command'];
  queryRaw: ScenarioDriver['query'];
}): ScenarioDriver {
  return {
    command: (request, context) => application.invokeRaw(request, context),
    query: (request, context) => application.queryRaw(request, context),
  };
}
export async function runScenarios(
  scenarios: readonly BehavioralScenario[],
  driver: ScenarioDriver,
): Promise<void> {
  for (const scenario of scenarios) {
    try {
      await scenario.run(driver);
    } catch (cause) {
      throw new Error(`Scenario failed: ${scenario.name}`, { cause });
    }
  }
}
export function assertEquivalent(actual: unknown, expected: unknown): void {
  if (canonicalJson(actual) !== canonicalJson(expected))
    throw new Error('Scenario outcomes differ');
}
