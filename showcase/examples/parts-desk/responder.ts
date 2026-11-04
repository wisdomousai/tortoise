import { toolName } from '@tortoise/agents/types';
import { agentInstructions } from '@tortoise/contracts';
import { deploymentCatalog } from '@tortoise/host/components';
import type { StandInMessage, StandInResponder } from '@tortoise/model-server/testing';
import { assistantAgent } from './contracts/assistant-agent';
import type { Part } from './contracts/part';
import { DESK_DISCOUNT_LIMIT } from './contracts/quote';
import type { Transformer } from './contracts/transformer';
import manifest from './manifest';

/** The question tool of the local harness (`ASK_TOOL` in `@tortoise/agents/ai-sdk`). */
const ASK = 'ask_person';
const FIND = toolName('transformer.find');
const SEARCH = toolName('part.search');
const LIST = toolName('quote.list');
const APPROVAL = toolName('approval.request');
const PREPARE = toolName('ui.prepare');

const SERIAL = /\bTR-?\d{1,5}\b/i;
const QUOTE_NUMBER = /\bQ-\d{5}\b/i;
const PERCENT = /(\d{1,3})\s*(?:%|percent)/i;
const BUSHINGS = /\bbushings?\b/i;
/** A request for a quote, such as "Prepare a quote of two HV bushings for TR-40417". */
const QUOTE_REQUEST = /\b(?:prepare|draft|make)\b[^.?!]*\bquote\b|\bquote\s+(?:of|for)\b/i;
/** How many bushings the quote holds, and whether HV or LV ones. */
const WANTED =
  /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(HV|LV)\s+)?bushings?\b/i;
const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** What `modelPrompt` adds when the run was started from a screen, which gives it the ui tools. */
const AT_SCREEN = 'This request was made from an application screen.';
/** Where the context the host appends to a run started from a screen begins (`modelPrompt`). */
const SCREEN_CONTEXT =
  /\n\n(?:This request was made from an application screen\.|Selected in the application when this request was made)/;

// The run route puts the assistant's instructions before the person's request, and the
// instructions themselves mention bushings and the discount limit, so only the rest is read.
const instructions = agentInstructions(deploymentCatalog(manifest), assistantAgent.id);

interface Call {
  readonly name: string;
  readonly input: Record<string, unknown>;
  result?: unknown;
}
type FoundTransformer = Transformer & { readonly customerName?: string };
type Page<T> = { readonly items: readonly T[]; readonly total: number };

const text = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part as { text?: string }).text ?? '').join('')
      : '';

function parse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * The request asked now: the last user message. A follow-up's earlier turns come before it as
 * messages of their own (`conversationMessages` in `@tortoise/agents`), so a serial from an
 * earlier turn does not steer the stand-in. The host appends what the screen offers
 * (`modelPrompt`), which is not the person's request either.
 */
const promptOf = (messages: readonly StandInMessage[]) =>
  text(messages.findLast((message) => message.role === 'user')?.content);

function requestOf(messages: readonly StandInMessage[]): string {
  const prompt = promptOf(messages);
  const request = prompt.startsWith(instructions) ? prompt.slice(instructions.length) : prompt;
  return request.split(SCREEN_CONTEXT)[0]!;
}

/** The calls so far, each with its result. The stand-in makes one call per reply. */
function callsIn(messages: readonly StandInMessage[]): Call[] {
  const calls: Call[] = [];
  for (const message of messages) {
    if (message.role === 'assistant')
      for (const call of message.tool_calls ?? []) {
        const args = parse(call.function.arguments) as { input?: Record<string, unknown> };
        calls.push({ name: call.function.name, input: args?.input ?? {} });
      }
    else if (message.role === 'tool') {
      const open = calls.find((call) => !('result' in call));
      if (open) open.result = parse(text(message.content));
    }
  }
  return calls;
}

const dataOf = <T>(call: Call) => (call.result as { data?: Page<T> } | undefined)?.data;
const refusalOf = (call: Call) =>
  (call.result as { error?: { code?: string; message?: string } } | undefined)?.error;
const answerOf = (call: Call | undefined) => {
  const answer = (call?.result as { answer?: unknown } | undefined)?.answer;
  return typeof answer === 'string' ? answer : undefined;
};
const use = (name: string, input: Record<string, unknown>) => ({
  call: { name, arguments: { input } },
});
const euro = (cents: number) => `${(cents / 100).toFixed(2)} EUR`;

/**
 * A quote for the transformer: part.search for the bushings it names, then ui.prepare fills the
 * quote builder's form with quote.create's input for the person to check and create. The run
 * creates nothing itself. Without a person at a screen there is no form to fill, so it answers
 * with the lines instead.
 */
function prepareQuote(
  request: string,
  transformer: FoundTransformer | undefined,
  calls: readonly Call[],
  atScreen: boolean,
) {
  if (!transformer) return { content: 'Which transformer is the quote for? Name its serial.' };
  const wanted = WANTED.exec(request);
  if (!wanted)
    return { content: `Which parts and how many should the quote for ${transformer.serial} hold?` };
  const count = wanted[1]!.toLowerCase();
  const quantity = Number(count) || NUMBERS.indexOf(count) + 1;
  const kind = `${(wanted[2] ?? 'HV').toUpperCase()} bushing`;
  const search = calls.find((call) => call.name === SEARCH);
  if (!search)
    return use(SEARCH, { transformerSerial: transformer.serial, category: 'bushing', text: kind });
  const part = dataOf<Part>(search)?.items[0];
  if (!part) return { content: `No ${kind}s fit ${transformer.serial}.` };
  const line = `${quantity} × ${part.partNumber}, ${part.description}, at ${euro(part.unitPrice)} each`;
  if (!atScreen)
    return {
      content: `A quote for ${transformer.serial} would hold ${line}. Ask me from the assistant panel and I fill in the quote form for you to check.`,
    };
  if (!calls.some((call) => call.name === PREPARE))
    return use(PREPARE, {
      operation: 'quote.create',
      input: {
        customerId: transformer.customerId,
        transformerSerial: transformer.serial,
        lines: [{ partNumber: part.partNumber, quantity }],
      },
    });
  return {
    content: `I filled in the quote form for ${transformer.serial} with ${line}. Check it and click Create draft.`,
  };
}

/**
 * The stand-in model for tests and the development launch, loaded by the llama-server stand-in
 * through `FIXTURE_RESPONDER`. It plays the assistant for a few requests and decides each reply
 * from the conversation's messages alone:
 *
 * - A serial that matches one transformer calls transformer.find, then answers with it.
 * - A partial serial that matches more than one asks the person with `ask_person` and continues
 *   with the answer.
 * - "Prepare a quote" for a serial and a number of HV or LV bushings calls part.search and then
 *   ui.prepare on quote.create, so the quote builder opens filled in for the person to create.
 * - "bushings" calls part.search for HV bushings, of the transformer when the request names one.
 * - A discount above 10 percent finds the quote with quote.list and calls approval.request for
 *   quote.discount.
 * - Anything else gets a short answer that it cannot help with that yet.
 *
 * In a follow-up it reads only the request asked now, not the earlier turns before it.
 *
 * A refused call ends the run with the refusal in the answer. A real model gets the same tools
 * and messages.
 */
const respond: StandInResponder = (messages) => {
  const request = requestOf(messages);
  const calls = callsIn(messages);
  for (const call of calls) {
    const refusal = refusalOf(call);
    if (refusal)
      return {
        content: `The desk refused the call: ${refusal.code} ${refusal.message ?? ''}`.trim(),
      };
  }

  // The transformer: the person's answer names it once they were asked, the request before.
  const asked = calls.find((call) => call.name === ASK);
  const answer = answerOf(asked);
  const serial = (answer && SERIAL.exec(answer)?.[0]) || SERIAL.exec(request)?.[0];
  let transformer: FoundTransformer | undefined;
  if (serial) {
    const find = calls.findLast((call) => call.name === FIND && call.input.serial === serial);
    if (!find) return use(FIND, { serial });
    const items = dataOf<FoundTransformer>(find)?.items ?? [];
    if (items.length === 0)
      return { content: `No transformer matches ${serial}. Which serial is on the rating plate?` };
    if (items.length > 1) {
      const choices = items.map((item) => item.serial);
      const question = `${serial} matches ${items.map((item) => `${item.serial} (${item.customerName})`).join(' and ')}. Which transformer do you mean?`;
      // Asked once only: an answer without a serial, or a run without a person at the screen,
      // which has no ask_person tool, gets the question as the answer.
      return asked
        ? { content: question }
        : { call: { name: ASK, arguments: { question, choices } } };
    }
    transformer = items[0];
  }

  if (QUOTE_REQUEST.test(request))
    return prepareQuote(request, transformer, calls, promptOf(messages).includes(AT_SCREEN));

  if (BUSHINGS.test(request)) {
    const search = calls.find((call) => call.name === SEARCH);
    if (!search)
      return use(SEARCH, {
        ...(transformer ? { transformerSerial: transformer.serial } : {}),
        category: 'bushing',
        text: 'HV bushing',
      });
    const parts = dataOf<Part>(search)?.items ?? [];
    const scope = transformer ? `fit ${transformer.serial}` : 'are in the catalog';
    if (!parts.length) return { content: `No HV bushings ${scope}.` };
    const lines = parts.map(
      (part) =>
        `${part.partNumber}, ${part.description}: ${part.stock} in stock, ${part.leadTimeDays} days lead time, ${euro(part.unitPrice)}`,
    );
    return { content: `These HV bushings ${scope}:\n${lines.join('\n')}` };
  }

  const percent = Number(PERCENT.exec(request)?.[1]);
  if (percent > DESK_DISCOUNT_LIMIT) {
    const number = QUOTE_NUMBER.exec(request)?.[0].toUpperCase();
    const list = calls.find((call) => call.name === LIST);
    if (!list) return use(LIST, number ? { search: number } : { status: 'draft' });
    const quotes = dataOf<{ id: string; number: string }>(list)?.items ?? [];
    // Without a number only a single open draft is the quote the person means.
    const quote = number
      ? quotes.find((item) => item.number === number)
      : quotes.length === 1
        ? quotes[0]
        : undefined;
    if (!quote)
      return {
        content: number
          ? `No quote ${number} is in the records.`
          : 'Which quote? Name its Q- number.',
      };
    if (!calls.some((call) => call.name === APPROVAL)) {
      const because = /\bbecause\s+(?:of\s+)?(.+?)[.!?]*$/is.exec(request)?.[1]?.trim();
      const reason = because
        ? because[0]!.toUpperCase() + because.slice(1)
        : `Asked for ${percent} percent`;
      return use(APPROVAL, {
        operation: 'quote.discount',
        input: { id: quote.id, percent, reason: reason.slice(0, 200) },
        rationale: request.trim().slice(0, 4000),
        resource: `quote:${quote.id}`,
      });
    }
    return {
      content: `I requested approval for ${percent} percent off ${quote.number}. A supervisor decides.`,
    };
  }

  if (transformer)
    return {
      content: `${transformer.serial} is a ${transformer.model} of ${transformer.customerName ?? 'an unnamed utility'} at substation ${transformer.substation}: ${transformer.ratingMva} MVA, ${transformer.voltage}, in service since ${transformer.yearInService}.`,
    };
  return {
    content:
      'I cannot help with that yet. I can find a transformer by its serial, list the HV bushings that fit it and request approval for a discount above 10 percent.',
  };
};

export default respond;
