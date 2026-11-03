/**
 * How the assistant panel writes the prompt of a follow-up. The local harness keeps no history
 * between runs, so a follow-up's prompt carries the earlier turns as text, before the request it
 * asks now. Browser-safe: the panel writes the prompt, and the stand-in model (`responder.ts`)
 * reads only the request.
 */

/** One earlier turn: what the person asked and the assistant's text. */
export interface Turn {
  readonly request: string;
  readonly answer: string;
}

const EARLIER = 'Earlier in this conversation:';
const NOW = 'The request now:';

/**
 * The most characters of earlier turns a prompt carries. The run route refuses a prompt above
 * 32,000 characters, so the oldest turns are left out first.
 */
export const MAX_EARLIER = 16_000;

/** The prompt for `request` after the `earlier` turns, or the request alone for the first. */
export function conversationPrompt(earlier: readonly Turn[], request: string): string {
  const turns = earlier.map(
    (turn) => `Person: ${turn.request}\nAssistant: ${turn.answer.trim() || '(no text)'}`,
  );
  while (turns.length && turns.join('\n\n').length > MAX_EARLIER) turns.shift();
  if (!turns.length) return request;
  return `${EARLIER}\n\n${turns.join('\n\n')}\n\n${NOW}\n${request}`;
}

/** The request a prompt asks now, without the earlier turns `conversationPrompt` put before it. */
export function currentRequest(prompt: string): string {
  const marker = `\n\n${NOW}\n`;
  const at = prompt.lastIndexOf(marker);
  return at < 0 ? prompt : prompt.slice(at + marker.length);
}
