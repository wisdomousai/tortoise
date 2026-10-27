import { join } from 'node:path';

/** A chat message as the stand-in receives it in the OpenAI chat completions format. */
export interface StandInMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content?: unknown;
  readonly tool_calls?: readonly {
    readonly id: string;
    readonly function: { readonly name: string; readonly arguments: string };
  }[];
}

/** One tool call, or a final answer. */
export type StandInReply =
  | { readonly call: { readonly name: string; readonly arguments: unknown } }
  | { readonly content: string };

/** The default export of a `FIXTURE_RESPONDER` module: the reply to a conversation so far. */
export type StandInResponder = (
  messages: readonly StandInMessage[],
) => StandInReply | Promise<StandInReply>;

/**
 * The script of a stand-in for llama.cpp's `llama-server`, for tests and development launches.
 * Declare it as the model server's process with Bun as the executable and this path as the
 * first argument. It takes llama-server's flags, refuses a missing model file, lists the model
 * under its alias and streams chat completions. It answers:
 *
 * - with `FIXTURE_RESPONDER` naming a module, what that module's default `StandInResponder`
 *   returns;
 * - with `FIXTURE_CALL` holding a tool name and arguments as JSON, that tool call, then `done`
 *   once a tool result is in the conversation;
 * - otherwise `done`.
 */
export const llamaServerStandIn = join(import.meta.dir, 'testing', 'llama-server.ts');
