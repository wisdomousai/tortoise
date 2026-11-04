import { defineAgent } from '@tortoise/contracts';
import { modelServer } from '@tortoise/model-server/contracts';
import { DESK_DISCOUNT_LIMIT } from './quote';

/** The model entry the assistant runs on. The deployment chooses its weights (`model.ts`). */
export const ASSISTANT_MODEL = 'parts-desk-assistant';

/** The process the model server starts, which the deployment policy binds to llama-server and pins. */
export const ASSISTANT_MODEL_PROCESS = 'llm';
export const assistantModelServer = modelServer({
  id: ASSISTANT_MODEL_PROCESS,
  runtime: 'llama-server',
});

/**
 * The desk's assistant, a direct agent: it reads every record of the desk and drafts, changes,
 * discounts and submits quotes itself. A discount above the desk's limit and every cancellation
 * go to a person as approval requests (`requests`), so its grant holds `approval.request` and
 * never `quote.cancel`. The policy of `quote.discount` refuses an agent run more than the limit
 * whoever started it, so the instructions only steer the model; the grant and the policy decide.
 * It runs only on the local `parts-desk-assistant` model, so prompts and records stay on the desk's
 * machine.
 */
export const assistantAgent = defineAgent({
  id: 'parts-desk.assistant',
  title: 'Assistant',
  instructions: [
    'You assist the spare parts desk of a power transformer plant. Utilities call the desk about bushings, tap changer parts, gaskets and relays for transformers in service, and the desk quotes the parts.',
    'Before anything else, call transformer.find with the serial the person gives, whole or partial, as the caller reads it off the rating plate. When it matches no transformer or more than one, ask the person which transformer they mean and wait for the answer. Never pick one yourself. Use the serial and the utility of the matched transformer in every later call.',
    'Answer only from the records. Look up the parts that fit with part.search and the transformer serial, and read utilities, inquiries and quotes with their list and get queries. Never guess a part number, a price, stock or a lead time. When the records do not hold the answer, say so. Name the records you read, such as the serial, the part numbers and the quote number.',
    'When a person is at the screen, prepare a quote with ui.prepare: operation quote.create and its complete input with customerId, transformerSerial, lines and, for a call, inquiryId. The person checks the form and creates the quote. Create a quote with quote.create, change its lines with quote.update or submit it with quote.submit only when the person asks you to.',
    `Set a discount of up to ${DESK_DISCOUNT_LIMIT} percent with quote.discount when the person asks for one. For a discount above ${DESK_DISCOUNT_LIMIT} percent, and for every cancellation, call approval.request for quote.discount or quote.cancel with the command's complete input, resource quote:<id> and the caller's reason as the rationale. Then tell the person that a supervisor decides.`,
  ].join('\n\n'),
  // #region grant
  operations: [
    'inquiry.list',
    'inquiry.get',
    'customer.list',
    'customer.get',
    'transformer.list',
    'transformer.get',
    'transformer.find',
    'part.list',
    'part.get',
    'part.search',
    'quote.list',
    'quote.get',
    'quote.create',
    'quote.update',
    'quote.discount',
    'quote.submit',
  ],
  requests: ['quote.discount', 'quote.cancel'],
  model: 'local',
  models: [ASSISTANT_MODEL],
  output: 'direct',
  // A local model that reasons before it calls a tool takes tens of seconds per turn on a laptop.
  budgets: { turns: 12, toolCalls: 30, wallTimeMs: 300_000 },
  // #endregion grant
});
