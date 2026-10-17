import { ApplicationError, type ModelRequirement } from '@agent-native/contracts';
import type { Harness } from './types';

/**
 * Whether a harness may run an agent with this model requirement. `local` admits only harnesses
 * that keep prompts on this host (`local` or `none`); `remote` admits provider harnesses and
 * `none`; `any` admits every harness. A harness that declares no inference counts as remote, so
 * an undeclared harness never satisfies `local`.
 */
export function satisfiesModel(requirement: ModelRequirement, harness: Harness): boolean {
  const inference = harness.inference ?? 'remote';
  if (requirement === 'any' || inference === 'none') return true;
  return inference === requirement;
}

/**
 * The first listed harness that meets the requirement and reports itself available. Throws
 * UNAVAILABLE naming each candidate's reason when none does, so the caller records why the run
 * did not start instead of falling back to a harness the definition does not allow.
 */
export async function chooseHarness(
  requirement: ModelRequirement,
  harnesses: readonly Harness[],
): Promise<Harness> {
  const reasons: string[] = [];
  for (const harness of harnesses) {
    if (!satisfiesModel(requirement, harness)) continue;
    const availability = await harness.availability().catch(() => ({
      available: false,
      reason: 'availability check failed',
    }));
    if (availability.available) return harness;
    reasons.push(`${harness.id}: ${availability.reason ?? 'unavailable'}`);
  }
  throw new ApplicationError(
    'UNAVAILABLE',
    reasons.length
      ? `No ${requirement} model is available (${reasons.join('; ')})`
      : `No harness meets the ${requirement} model requirement`,
  );
}
