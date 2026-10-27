import { toolName } from '@agent-native/agents/types';
import type { StandInMessage, StandInResponder } from '@agent-native/model-server/testing';

/**
 * The stand-in model for tests and the development launch, loaded by the llama-server stand-in
 * through `FIXTURE_RESPONDER`. It plays what a model fine-tuned on the lab's decisions answers:
 * it reads the test request the trigger names, then requests approval for the method its
 * description asks for. A real model gets the same tools and messages.
 */
const methods: readonly (readonly [RegExp, string])[] = [
  [/\bgas\b/i, 'IEC 60567 dissolved gas analysis'],
  [/\bbreakdown\b/i, 'IEC 60156 breakdown voltage'],
  [/\bdissipation\b/i, 'IEC 60247 dissipation factor'],
  [/\b(?:furan|paper aging)\b/i, 'IEC 61198 furan analysis'],
];

const text = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part as { text?: string }).text ?? '').join('')
      : '';

/** The first object in a tool result with a description: the test request it read. */
function requestIn(
  value: unknown,
): { method?: string; description: string; revision?: number } | undefined {
  if (typeof value === 'string') {
    try {
      return requestIn(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object') return undefined;
  if (typeof (value as { description?: unknown }).description === 'string')
    return value as { description: string };
  for (const nested of Object.values(value)) {
    const found = requestIn(nested);
    if (found) return found;
  }
  return undefined;
}

const respond: StandInResponder = (messages: readonly StandInMessage[]) => {
  const asked = messages
    .filter((message) => message.role === 'user')
    .map((message) => text(message.content))
    .join('\n');
  const id = /test-request:([\w-]+)/.exec(asked)?.[1];
  const results = messages.filter((message) => message.role === 'tool');
  if (!id) return { content: 'No test request was named.' };
  if (results.length === 0)
    return { call: { name: toolName('test-request.get'), arguments: { input: { id } } } };
  if (results.length > 1) return { content: 'Requested approval for the test method.' };
  const request = requestIn(results[0]!.content);
  if (!request) return { content: 'The test request could not be read.' };
  if (request.method) return { content: 'The test request already has a method.' };
  const method = methods.find(([words]) => words.test(request.description))?.[1];
  if (!method) return { content: 'No test method fits the description.' };
  const resource = `test-request:${id}`;
  return {
    call: {
      name: toolName('approval.request'),
      arguments: {
        input: {
          operation: 'test-request.update',
          input: { id, method },
          rationale: `The description asks for ${method}.`,
          resource,
          baseRevisions: { [resource]: request.revision ?? 1 },
        },
      },
    },
  };
};

export default respond;
