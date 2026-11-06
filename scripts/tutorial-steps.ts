/** Prompt extraction and checkpoint validation for the tutorial runner. */
export interface TutorialStep {
  readonly heading: string;
  readonly prompt: string;
}

export function tutorialSteps(source: string): TutorialStep[] {
  const steps: TutorialStep[] = [];
  let heading = '';
  let fence: string | undefined;
  let prompt: string[] | undefined;
  for (const line of source.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1]![0] === fence[0] &&
        marker[1]!.length >= fence.length &&
        !marker[2]!.trim()
      ) {
        if (prompt) {
          const text = prompt.join('\n').trim();
          if (!heading || !text)
            throw new Error('A tutorial prompt needs an H2 heading and nonempty text.');
          if (steps.some((step) => step.heading === heading))
            throw new Error(`More than one prompt under ${heading}.`);
          steps.push({ heading, prompt: text });
        }
        fence = undefined;
        prompt = undefined;
      } else prompt?.push(line);
    } else if (marker) {
      fence = marker[1]!;
      if (marker[2]!.trim() === 'text prompt') prompt = [];
    } else if (line.startsWith('## ')) heading = line.slice(3).trim();
  }
  if (prompt) throw new Error('Unclosed tutorial prompt fence.');
  if (!steps.length) throw new Error('No tutorial prompts found.');
  return steps;
}

export function tutorialApplication(source: string, override?: string): string {
  const declared = [...source.matchAll(/\/path\/to\/([a-z][a-z0-9-]*)/g)].map((match) => match[1]!);
  const referenced = new Set(
    [...source.matchAll(/showcase\/examples\/([a-z][a-z0-9-]*)/g)].map((match) => match[1]!),
  );
  const selected = declared.filter((name) => referenced.has(name));
  const candidates =
    referenced.size === 1
      ? referenced
      : new Set(selected.length ? selected : referenced.size ? referenced : declared);
  if (override && !/^[a-z][a-z0-9-]*$/.test(override)) throw new Error('Invalid application name.');
  if (override && candidates.size && !candidates.has(override))
    throw new Error('The application does not match the tutorial.');
  if (!override && candidates.size !== 1)
    throw new Error('Cannot identify one tutorial application; pass --app.');
  return override ?? [...candidates][0]!;
}

export function tutorialRange(from: number, to: number, length: number): void {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > length)
    throw new Error(`Step range must be within 1..${length}.`);
}

export interface TutorialCheckpoint {
  readonly exportDirectory: string;
  readonly page: string;
  readonly step: number;
  readonly commit: string;
}

export function requireCheckpoint(
  checkpoint: TutorialCheckpoint | undefined,
  expected: TutorialCheckpoint,
): void {
  if (
    !checkpoint ||
    Object.entries(expected).some(
      ([key, value]) => checkpoint[key as keyof TutorialCheckpoint] !== value,
    )
  )
    throw new Error('The export does not match the preceding successful tutorial checkpoint.');
}
