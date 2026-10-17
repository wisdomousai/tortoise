import { ApplicationError, type ModelRequirement } from '@agent-native/contracts';
import type { Harness } from './types';

/** What an agent asks of the model beyond its requirement: named entries, and who it is. */
export interface ModelDemand {
  /** Model entry IDs the agent may run on (`AgentDefinition.models`). */
  readonly models?: readonly string[];
  /** The agent's ID, checked against the harness entry's `agents`. */
  readonly agent?: string;
}

/**
 * Whether a harness may run an agent with this model requirement. `local` admits only harnesses
 * that keep prompts on this host (`local` or `none`); `remote` admits provider harnesses and
 * `none`; `any` admits every harness. A harness that declares no inference counts as remote, so
 * an undeclared harness never satisfies `local`. Named models admit only a harness serving one of
 * those entries, and an entry that lists its agents admits only those.
 */
export function satisfiesModel(
  requirement: ModelRequirement,
  harness: Harness,
  demand: ModelDemand = {},
): boolean {
  const inference = harness.inference ?? 'remote';
  if (inference === 'none') return true;
  if (requirement !== 'any' && inference !== requirement) return false;
  if (demand.models && !(harness.model?.entry && demand.models.includes(harness.model.entry)))
    return false;
  if (harness.agents && !(demand.agent && harness.agents.includes(demand.agent))) return false;
  return true;
}

/**
 * The first listed harness that meets the requirement and reports itself available. Throws
 * UNAVAILABLE naming each candidate's reason when none does, so the caller records why the run
 * did not start instead of falling back to a harness the definition does not allow.
 */
export async function chooseHarness(
  requirement: ModelRequirement,
  harnesses: readonly Harness[],
  demand: ModelDemand = {},
): Promise<Harness> {
  const reasons: string[] = [];
  for (const harness of harnesses) {
    if (!satisfiesModel(requirement, harness, demand)) continue;
    const availability = await harness.availability().catch(() => ({
      available: false,
      reason: 'availability check failed',
    }));
    if (availability.available) return harness;
    reasons.push(`${harness.id}: ${availability.reason ?? 'unavailable'}`);
  }
  const wanted = demand.models
    ? `${requirement} model (${demand.models.join(', ')})`
    : `${requirement} model`;
  throw new ApplicationError(
    'UNAVAILABLE',
    reasons.length
      ? `No ${wanted} is available (${reasons.join('; ')})`
      : `No harness meets the ${wanted} requirement`,
  );
}
