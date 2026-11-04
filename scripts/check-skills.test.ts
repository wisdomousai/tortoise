import { afterEach, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'skill-coverage-'));
  temporary.push(directory);
  mkdirSync(join(directory, 'scripts'), { recursive: true });
  for (const file of [
    'check-skills.ts',
    'skills.ts',
    'skill-api.ts',
    'skills-stamp.ts',
    'markdown-links.ts',
  ])
    cpSync(join(import.meta.dir, file), join(directory, 'scripts', file));
  const write = (path: string, content: string) => {
    mkdirSync(join(directory, path, '..'), { recursive: true });
    writeFileSync(join(directory, path), content);
  };
  write('package.json', JSON.stringify({ scripts: {} }));
  write('AGENTS.md', 'packages/sample/skills/sample-skill/SKILL.md\n');
  write('packages/sample/package.json', JSON.stringify({ exports: { '.': './src/index.ts' } }));
  write('packages/sample/src/index.ts', 'export const initial = 1;\n');
  write('packages/sample/README.md', '# Sample\n\n## Skills\n\nSee the skill.\n');
  write(
    'packages/sample/skills/sample-skill/SKILL.md',
    '---\nname: sample-skill\ndescription: Use the sample.\n---\n\n# Sample\n',
  );
  write(
    'scripts/skill-coverage.json',
    JSON.stringify({ 'packages/sample': { skills: ['sample-skill'] } }),
  );
  expect(run(directory, 'skills-stamp.ts').status).toBe(0);
  return directory;
}

function run(directory: string, script = 'check-skills.ts') {
  return spawnSync(process.execPath, [join(directory, 'scripts', script)], { encoding: 'utf8' });
}

test('coverage does not depend on README headings or even a README', () => {
  const directory = fixture();
  writeFileSync(
    join(directory, 'packages/sample/README.md'),
    '# Another title\n\n## Task guides\n',
  );
  expect(run(directory).status).toBe(0);
  rmSync(join(directory, 'packages/sample/README.md'));
  expect(run(directory).status).toBe(0);
});

test('missing coverage, unknown skills and an omitted owner are reported', () => {
  const directory = fixture();
  const coverage = join(directory, 'scripts/skill-coverage.json');
  writeFileSync(coverage, '{}');
  expect(run(directory).stderr).toContain('missing coverage for packages/sample');
  writeFileSync(coverage, JSON.stringify({ 'packages/sample': { skills: ['unknown'] } }));
  const result = run(directory);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('unknown skill unknown');
  expect(result.stderr).toContain('does not list its own skill sample-skill');
  writeFileSync(coverage, JSON.stringify({ 'packages/sample': { skills: [] } }));
  expect(run(directory).stderr).toContain('needs a reason when no skills cover it');
});

test('a changed public API names its reviewers', () => {
  const directory = fixture();
  writeFileSync(join(directory, 'packages/sample/src/index.ts'), 'export const changed = 1;\n');
  const result = run(directory);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('public API changed');
  expect(result.stderr).toContain('packages/sample/skills/sample-skill/SKILL.md');
});

test('coverage can name a skill from an installed framework package', () => {
  const directory = fixture();
  const installed = join(directory, 'node_modules/@tortoise/shared/skills/external-skill');
  mkdirSync(installed, { recursive: true });
  writeFileSync(
    join(installed, 'SKILL.md'),
    '---\nname: external-skill\ndescription: Use the installed skill.\n---\n\n# External\n',
  );
  writeFileSync(
    join(directory, 'scripts/skill-coverage.json'),
    JSON.stringify({ 'packages/sample': { skills: ['sample-skill', 'external-skill'] } }),
  );
  expect(run(directory).status).toBe(0);
});
