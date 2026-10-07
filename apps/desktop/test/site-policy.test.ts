import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { assertPolicyUsable, loadSitePolicy } from '@agent-native/egress';
import { deploymentRequirements } from '@agent-native/host/security';
import { configuredApplication } from '../../service/src/application';

test('the policy shipped with the desktop build binds only provider endpoints', async () => {
  const policy = await loadSitePolicy(
    join(import.meta.dir, '../site-policy.json'),
    deploymentRequirements((await configuredApplication()).manifest),
  );
  expect(() => assertPolicyUsable(policy)).not.toThrow();
  expect([...policy.bindings.keys()].sort()).toEqual([
    'anthropic-api',
    'openai-api',
    'openai-auth',
  ]);
  expect(policy.policy.audit.mode).toBe('fail-closed');
});
