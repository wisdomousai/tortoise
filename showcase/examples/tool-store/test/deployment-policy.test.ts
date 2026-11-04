import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createCli } from '@tortoise/host/cli';
import { createToolStoreApplication } from '../application';

const policyFile = join(import.meta.dir, '../deployment-policy.store-terminal.json');

/**
 * Checked through the application's own `policy check` verb, as an installer would. A destination
 * a later change declares stays unbound until the policy names it, so this test fails until the
 * deployment policy binds or disables it.
 */
test('the store terminal policy binds only the EAM and disables every other destination', async () => {
  const main = createCli(createToolStoreApplication(), { program: 'tool-store' });
  const output: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string) => output.push(chunk) > 0) as typeof write;
  let code: number;
  try {
    code = await main(['policy', 'check', '--policy', policyFile]);
  } finally {
    process.stdout.write = write;
  }
  const report = JSON.parse(output.join('')) as {
    ok: boolean;
    profile: string;
    bound: string[];
    disabled: string[];
    findings: { level: string; code: string; destination?: string }[];
    consequences: { destination: string; reason: string }[];
  };
  expect(code).toBe(0);
  expect(report.ok).toBe(true);
  expect(report.profile).toBe('hub');
  expect(report.findings.filter((finding) => finding.level === 'error')).toEqual([]);
  expect(report.bound).toEqual(['eam-api']);
  expect(report.disabled).toEqual([
    'anthropic-api',
    'audit-collector',
    'local-inference',
    'openai-api',
    'openai-auth',
    'workforce-idp',
  ]);
  expect(report.consequences.filter((item) => item.reason !== 'disabled')).toEqual([]);
  const file = (await Bun.file(policyFile).json()) as {
    destinations: Record<string, { url?: string }>;
    audit?: { mode?: string };
  };
  expect(file.destinations['eam-api']?.url).toBe('https://eam.plant.example');
  expect(file.audit?.mode).toBe('fail-closed');
});
