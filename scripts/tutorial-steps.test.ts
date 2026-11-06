import { expect, test } from 'bun:test';
import {
  requireCheckpoint,
  tutorialApplication,
  tutorialRange,
  tutorialSteps,
} from './tutorial-steps';

test('extracts prompts without treating headings and prompt fences inside displayed code as steps', () => {
  const source =
    '# Tutorial\n## Export\n```text prompt\nCreate /path/to/tool-store\n```\n````md\n## Fake\n```text prompt\nnot a step\n```\n````\n## Records\n```text prompt\nChange records\n```';
  expect(tutorialSteps(source)).toEqual([
    { heading: 'Export', prompt: 'Create /path/to/tool-store' },
    { heading: 'Records', prompt: 'Change records' },
  ]);
});

test('refuses incomplete or ambiguous prompt structure before running an agent', () => {
  expect(() => tutorialSteps('## Export\n```text prompt\nunfinished')).toThrow('Unclosed');
  expect(() => tutorialSteps('```text prompt\nno heading\n```')).toThrow('H2');
  expect(() => tutorialSteps('## Empty\n```text prompt\n```')).toThrow('nonempty');
  expect(() => tutorialSteps('## Same\n```text prompt\na\n```\n```text prompt\nb\n```')).toThrow(
    'More than one',
  );
});

test('application identity comes from tutorial content rather than export folder name', () => {
  expect(tutorialApplication('Create /path/to/tool-store')).toBe('tool-store');
  expect(tutorialApplication('Change showcase/examples/parts-desk/application.ts')).toBe(
    'parts-desk',
  );
  expect(
    tutorialApplication('Change showcase/examples/parts-desk/model.ts using /path/to/model.gguf'),
  ).toBe('parts-desk');
  expect(() => tutorialApplication('Create /path/to/tool-store', 'parts-desk')).toThrow('match');
  expect(() => tutorialApplication('showcase/examples/a and showcase/examples/b')).toThrow('one');
});

test('rejects invalid step ranges and resumption against a different commit or export', () => {
  for (const [from, to] of [
    [0, 1],
    [1, 8],
    [2, 1],
    [1.5, 2],
    [NaN, 2],
  ])
    expect(() => tutorialRange(from!, to!, 4)).toThrow();
  const saved = { exportDirectory: '/tmp/desk', page: 'chapter-1', step: 3, commit: 'abc' };
  expect(() => requireCheckpoint(saved, saved)).not.toThrow();
  expect(() => requireCheckpoint(saved, { ...saved, commit: 'changed' })).toThrow('checkpoint');
  expect(() => requireCheckpoint(saved, { ...saved, exportDirectory: '/tmp/other' })).toThrow(
    'checkpoint',
  );
  expect(() => requireCheckpoint(undefined, saved)).toThrow('checkpoint');
});
