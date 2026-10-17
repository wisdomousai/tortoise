import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createCli } from '@agent-native/host/cli';
import { configuredApplication } from '../../service/src/application';

/**
 * Checked through the application's own `site check` verb, as an installer would, so the starter
 * needs no import from the site plugin that defines the policy.
 */
test('the policy shipped with the desktop build binds only provider endpoints', async () => {
  const main = createCli(await configuredApplication(), { program: 'workspace' });
  const output: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string) => output.push(chunk) > 0) as typeof write;
  let code: number;
  try {
    code = await main(['site', 'check', '--site', join(import.meta.dir, '../site-policy.json')]);
  } finally {
    process.stdout.write = write;
  }
  const report = JSON.parse(output.join('')) as {
    ok: boolean;
    bound: string[];
    findings: { level: string }[];
  };
  expect(code).toBe(0);
  expect(report.ok).toBe(true);
  expect(report.findings.filter((finding) => finding.level === 'error')).toEqual([]);
  expect(report.bound).toEqual(['anthropic-api', 'openai-api', 'openai-auth']);
  const file = (await Bun.file(join(import.meta.dir, '../site-policy.json')).json()) as {
    audit?: { mode?: string };
  };
  expect(file.audit?.mode).toBe('fail-closed');
});
