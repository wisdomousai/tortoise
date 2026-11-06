/**
 * Execute one tutorial chapter with Claude Code in a disposable source export.
 * This runner uses the locally configured Claude CLI and may consume provider usage.
 * It records generic checks; the page's manual acceptance checks still need separate execution.
 *
 * bun scripts/tutorial-run.ts <page.mdx> --export <dir> [--from n] [--to n] [--model sonnet]
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requireCheckpoint,
  tutorialApplication,
  tutorialRange,
  tutorialSteps,
  type TutorialCheckpoint,
} from './tutorial-steps';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('CLAUDE')),
);
function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? String(result.error) : ''}`,
  };
}
function checked(command: string, args: string[], cwd: string): string {
  const result = run(command, args, cwd);
  if (result.status) throw new Error(`${command} ${args.join(' ')} failed: ${result.output}`);
  return result.output.trim();
}
function assertExport(directory: string, app: string) {
  const config = JSON.parse(readFileSync(join(directory, 'app.config.json'), 'utf8')) as {
    application: string;
  };
  const appDirectory = join(directory, 'showcase/examples', app);
  const manifest = JSON.parse(readFileSync(join(appDirectory, 'package.json'), 'utf8')) as {
    name: string;
  };
  if (
    config.application !== manifest.name &&
    resolve(directory, config.application) !== appDirectory
  )
    throw new Error('The selected application does not match this tutorial.');
  const top = checked('git', ['rev-parse', '--show-toplevel'], directory);
  if (realpathSync(top) !== realpathSync(directory))
    throw new Error('The export must have its own Git repository.');
}
function main() {
  const [pageArgument, ...arguments_] = process.argv.slice(2);
  if (!pageArgument)
    throw new Error(
      'Usage: tutorial-run.ts <page.mdx> --export <dir> [--from n] [--to n] [--model name] [--app name]',
    );
  const options = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index]!;
    const value = arguments_[index + 1];
    if (
      !['--export', '--from', '--to', '--model', '--app'].includes(name) ||
      !value ||
      value.startsWith('--') ||
      options.has(name)
    )
      throw new Error(`Invalid option ${name}.`);
    options.set(name, value);
  }
  if (!options.has('--export')) throw new Error('--export is required.');
  const page = resolve(root, pageArgument);
  const exportDirectory = resolve(options.get('--export')!);
  if (exportDirectory === root || exportDirectory.startsWith(root + '/'))
    throw new Error('Use a disposable export outside the framework checkout.');
  const source = readFileSync(page, 'utf8');
  const steps = tutorialSteps(source);
  const app = tutorialApplication(source, options.get('--app'));
  const from = Number(options.get('--from') ?? '1');
  const to = Number(options.get('--to') ?? steps.length);
  tutorialRange(from, to, steps.length);
  const model = options.get('--model') ?? 'sonnet';
  const chapter = basename(page).replace(/\.mdx?$/, '');
  const logs = join(root, 'artifacts/tutorial-runs', app);
  const checkpointFile = join(logs, 'checkpoint.json');
  const creation = from === 1 && steps[0]!.prompt.includes(`/path/to/${app}`);
  if (creation) {
    if (existsSync(exportDirectory))
      throw new Error('The initial export directory must not exist.');
  } else {
    assertExport(exportDirectory, app);
    if (checked('git', ['status', '--porcelain'], exportDirectory))
      throw new Error('Resume from a clean export checkpoint.');
    const saved = existsSync(checkpointFile)
      ? (JSON.parse(readFileSync(checkpointFile, 'utf8')) as TutorialCheckpoint)
      : undefined;
    let previousPage = relative(root, page);
    let previousStep = from - 1;
    if (from === 1) {
      const number = Number(new RegExp(`^${app}-(\\d+)-`).exec(chapter)?.[1]);
      if (!Number.isInteger(number) || number < 2)
        throw new Error('Cannot identify the previous chapter.');
      const previous = readdirSync(dirname(page)).filter(
        (name) => name.startsWith(`${app}-${number - 1}-`) && /\.mdx?$/.test(name),
      );
      if (previous.length !== 1) throw new Error('Cannot identify one previous chapter.');
      const previousFile = join(dirname(page), previous[0]!);
      previousPage = relative(root, previousFile);
      previousStep = tutorialSteps(readFileSync(previousFile, 'utf8')).length;
    }
    requireCheckpoint(saved, {
      exportDirectory,
      page: previousPage,
      step: previousStep,
      commit: checked('git', ['rev-parse', 'HEAD'], exportDirectory),
    });
  }
  const runDirectory = join(logs, chapter, new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(runDirectory, { recursive: true });
  const checks: readonly (readonly string[])[] = [
    ['bun', 'run', 'format'],
    ['bun', 'run', 'generate'],
    ['bun', 'run', 'typecheck'],
    ['bun', 'test', `showcase/examples/${app}`],
    ['bun', 'run', 'build'],
    ['bunx', 'playwright', 'test', `showcase/examples/${app}`],
  ];
  for (let index = from; index <= to; index++) {
    const step = steps[index - 1]!;
    const first = creation && index === 1;
    const prompt = step.prompt.replaceAll(`/path/to/${app}`, exportDirectory);
    const report = [
      `# ${chapter}: ${step.heading}`,
      `Export: ${exportDirectory}`,
      `Model: ${model}`,
      '## Prompt',
      '```text\n' + prompt + '\n```',
    ];
    const file = join(runDirectory, `${String(index).padStart(2, '0')}.md`);
    console.log(`${chapter}, step ${index}: ${step.heading}`);
    try {
      const result = run(
        'claude',
        [
          '-p',
          prompt,
          '--model',
          model,
          '--dangerously-skip-permissions',
          '--output-format',
          'text',
        ],
        first ? root : exportDirectory,
      );
      report.push(`## Agent report (exit ${result.status})`, result.output);
      if (result.status) throw new Error('The coding agent failed.');
      assertExport(exportDirectory, app);
      for (const [command, ...args] of checks) {
        const check = run(command!, [...args], exportDirectory);
        report.push(
          `## ${command} ${args.join(' ')} (exit ${check.status})`,
          '```text\n' + check.output + '\n```',
        );
        if (check.status)
          throw new Error('A generic check failed. The failure is preserved in the report.');
      }
      checked('git', ['add', '-A'], exportDirectory);
      const staged = run('git', ['diff', '--cached', '--quiet'], exportDirectory);
      if (staged.status === 1)
        checked('git', ['commit', '-qm', `${chapter}: ${step.heading}`], exportDirectory);
      else if (staged.status !== 0) throw new Error(staged.output);
      const checkpoint: TutorialCheckpoint = {
        exportDirectory,
        page: relative(root, page),
        step: index,
        commit: checked('git', ['rev-parse', 'HEAD'], exportDirectory),
      };
      if (checked('git', ['status', '--porcelain'], exportDirectory))
        throw new Error('The completed export is not clean.');
      writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2) + '\n');
      report.push(
        'Generic checks passed. Manual acceptance checks are not recorded by this runner.',
        `Checkpoint commit: ${checkpoint.commit}`,
      );
    } catch (error) {
      report.push('## Failure', String(error));
      throw error;
    } finally {
      writeFileSync(file, report.join('\n\n') + '\n');
      console.log(`Report: ${file}`);
    }
  }
}
if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
