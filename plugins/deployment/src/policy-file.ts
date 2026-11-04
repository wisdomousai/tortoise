import { resolve } from 'node:path';
import { isolatedPolicy, loadDeploymentPolicy, type ResolvedPolicy } from './policy';
import { deploymentRequirements } from '@tortoise/host/components';
import type { ApplicationManifest } from '@tortoise/host/manifest';

/**
 * A deployment policy file resolved against one application's composed declarations, or the isolated
 * default without a file. Used by offline CLI verbs, which open no workspace and no plugin.
 * Throws when the file cannot be read or parsed; findings are returned, not thrown.
 */
export async function deploymentPolicyFor(
  manifest: ApplicationManifest,
  path: string | undefined,
): Promise<ResolvedPolicy> {
  const requirements = deploymentRequirements(manifest);
  return path ? loadDeploymentPolicy(resolve(path), requirements) : isolatedPolicy(requirements);
}

/** The error findings a policy is refused for, at startup and by `policy check`. */
export const policyErrors = (policy: ResolvedPolicy) =>
  policy.findings.filter((finding) => finding.level === 'error');
