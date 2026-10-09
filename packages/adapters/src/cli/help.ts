import type { Catalog, CatalogOperation } from '@agent-native/contracts';
import { commandWords, fieldSpecs, synopsis } from '../cli-syntax';
import { CliText } from './types';

export function operationHelp(operation: CatalogOperation, program: string): CliText {
  const fields = fieldSpecs(operation.inputSchema);
  const lines = [
    synopsis(operation, program),
    '',
    operation.description || operation.id,
    '',
    `Kind: ${operation.kind}${operation.kind === 'command' ? ' (changes state; pass --key to retry safely)' : ''}`,
  ];
  if (operation.integration)
    lines.push(
      `Forwarded to ${operation.integration.target} after commit; a receipt is not acceptance.`,
    );
  if (operation.remote)
    lines.push(
      `Reads ${operation.remote.target} live when called; the result is not stored and may report the source unavailable.`,
    );
  if (fields.length) {
    lines.push('', 'Flags:');
    const width = Math.max(...fields.map((field) => field.flag.length)) + 2;
    for (const field of fields)
      lines.push(
        `  --${field.flag.padEnd(width)}${field.type}${field.choices.length ? ` (${field.choices.join(', ')})` : ''}${field.required ? ', required' : ''}${field.nullable ? ', or null' : ''}${field.description ? ` — ${field.description}` : ''}`,
      );
  }
  lines.push(
    '',
    'Also: --json <object|-> for the whole input, --dry-run to validate without executing,',
    '--output json|text. Commands accept --key <id> and --revisions <json>.',
  );
  return new CliText(lines.join('\n'));
}

const firstSentence = (text: string) => {
  const sentence = text.split(/(?<=\.)\s/)[0]!.split('\n')[0]!;
  return sentence.length > 90 ? `${sentence.slice(0, 89)}…` : sentence;
};

export function overview(catalog: Catalog, program: string): CliText {
  const rows = catalog.operations.map((operation) => [
    commandWords(operation).join(' '),
    `${operation.kind === 'command' ? '✎' : ' '} ${operation.description || operation.id}`,
  ]);
  const width = Math.max(...rows.map(([words]) => words!.length)) + 2;
  return new CliText(
    [
      `Usage: ${program} <command> [--field value ...] [--json <object|->] [--dry-run] [--output json|text]`,
      '',
      'Commands (✎ changes state):',
      ...rows.map(([words, text]) => `  ${words!.padEnd(width)}${firstSentence(text!)}`),
      '',
      `Run "${program} help <command>" for flags. Other verbs: list, schema [command],`,
      'workflows [id]. Commands also take --key key and --revisions json.',
      'Exit status: 0 ok, 2 invalid input, 3 not found, 4 forbidden, 5 conflict,',
      '6 idempotency conflict, 7 cancelled, 8 unavailable, 1 internal.',
    ].join('\n'),
  );
}
