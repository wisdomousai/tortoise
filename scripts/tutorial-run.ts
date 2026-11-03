/**
 * Run a tutorial's prompts with Claude Code, one step after another, so the page is the source
 * of what ran. The prompts are the page's ```text prompt fences in order. Step 1 runs in this
 * repository with the export directory substituted for `/path/to/<app>`; later steps run in the
 * export. After each step the standard check runs in the export and the export commits, so a
 * failed step can be redone with `--from`. Each step's report and check output go to
 * `artifacts/tutorial-runs/<app>/<nn>-<slug>.md`.
 *
 *   bun scripts/tutorial-run.ts docs/tutorial.md --export ~/repos/tutorial-runs/tool-store [--from 2] [--to 5] [--model sonnet]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const page = process.argv[2];
const exportDirectory = option('--export');
if (!page || !exportDirectory) {
  console.error(
    'Usage: bun scripts/tutorial-run.ts <page.md> --export <dir> [--from n] [--to n] [--model sonnet]',
  );
  process.exit(2);
}
const from = Number(option('--from', '1'));
const model = option('--model', 'sonnet')!;
const app = basename(exportDirectory);
const source = readFileSync(resolve(root, page), 'utf8');

/** The prompts with the H2 heading each one sits under. */
const steps: { heading: string; prompt: string }[] = [];
{
  let heading = '';
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('## ')) heading = line.slice(3).replace(/^\d+\.\s*/, '');
    if (line === '```text prompt') {
      const end = lines.indexOf('```', i + 1);
      steps.push({ heading, prompt: lines.slice(i + 1, end).join('\n') });
      i = end;
    }
  }
}
const to = Number(option('--to', String(steps.length)));
const logs = join(root, 'artifacts', 'tutorial-runs', app);
mkdirSync(logs, { recursive: true });
console.log(
  `${steps.length} prompts in ${page}; running ${from}-${to} as ${app} in ${exportDirectory}`,
);

// Claude Code refuses to start inside another Claude Code session, so its variables stay out.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('CLAUDE')),
);
const run = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

const checks = [
  'bun run format',
  'bun run generate',
  'bun run typecheck',
  `bun test showcase/examples/${app}`,
  'bun run build',
  `bunx playwright test showcase/examples/${app}`,
];

for (let n = from; n <= to; n++) {
  const step = steps[n - 1]!;
  const first = n === 1;
  const cwd = first ? root : exportDirectory;
  const prompt = step.prompt.replace(new RegExp(`/path/to/${app}`, 'g'), exportDirectory);
  if (!first && !existsSync(join(exportDirectory, 'package.json')))
    throw new Error(`No export at ${exportDirectory}; run step 1 first`);
  const slug = step.heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const log = join(logs, `${String(n).padStart(2, '0')}-${slug}.md`);
  const started = Date.now();
  console.log(`\n== Step ${n}: ${step.heading} (${cwd})`);
  const agent = run(
    'claude',
    ['-p', prompt, '--model', model, '--dangerously-skip-permissions', '--output-format', 'text'],
    cwd,
  );
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  const sections = [
    `# Step ${n}: ${step.heading}`,
    `Ran in ${cwd} with ${model}, ${minutes} min, exit ${agent.status}.`,
    '## Prompt',
    '```text\n' + prompt + '\n```',
    '## Report',
    agent.output.trim(),
  ];
  let failed = agent.status !== 0;
  if (!failed) {
    sections.push('## Checks');
    for (const check of checks) {
      const [command, ...args] = check.split(' ');
      const result = run(command!, args, exportDirectory);
      const tail = result.output.trim().split('\n').slice(-25).join('\n');
      sections.push(`### ${check} (exit ${result.status})`, '```text\n' + tail + '\n```');
      if (result.status !== 0) {
        failed = true;
        break;
      }
    }
  }
  if (!failed) {
    run('git', ['add', '-A'], exportDirectory);
    run('git', ['commit', '-qm', `Step ${n}: ${step.heading}`], exportDirectory);
  }
  writeFileSync(log, sections.join('\n\n') + '\n');
  console.log(`${failed ? 'FAILED' : 'ok'} after ${minutes} min, log ${log}`);
  if (failed) process.exit(1);
}
