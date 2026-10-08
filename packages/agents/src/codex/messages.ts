import { protocolRecord, type AsyncChannel, type RpcMessage, type StdioJsonRpc } from '../process';
import type { HarnessEvent, HarnessTurn, ToolDefinition } from '../types';

/** What the message handler of one turn shares with the harness. */
export interface CodexTurn {
  readonly rpc: StdioJsonRpc;
  readonly channel: AsyncChannel<HarnessEvent>;
  readonly turn: HarnessTurn;
  readonly tools: ReadonlyMap<string, ToolDefinition>;
  readonly completedCalls: Map<string, { fingerprint: string; result: Promise<unknown> }>;
  /** Native IDs once known; completions for other threads or turns are ignored. */
  readonly ids: () => { threadId?: string; turnId?: string };
}
type Params = Record<string, unknown>;

/** Run an application tool once per native call ID and answer with its JSON result. */
async function callTool(state: CodexTurn, id: NonNullable<RpcMessage['id']>, params: Params) {
  const { rpc, channel, turn } = state;
  const definition = typeof params.tool === 'string' ? state.tools.get(params.tool) : undefined;
  if (!definition || params.namespace || typeof params.callId !== 'string') {
    rpc.respond(id, {
      success: false,
      contentItems: [{ type: 'inputText', text: 'Unknown application tool' }],
    });
    return;
  }
  if (
    !params.callId ||
    params.callId.length > 256 ||
    !params.arguments ||
    typeof params.arguments !== 'object' ||
    Array.isArray(params.arguments)
  )
    throw new Error('Malformed native tool envelope');
  turn.signal.throwIfAborted();
  let call = state.completedCalls.get(params.callId);
  const fingerprint = JSON.stringify([definition.operation, params.arguments]);
  if (call && call.fingerprint !== fingerprint)
    throw new Error('Native tool call ID reused with different arguments');
  if (!call) {
    channel.push({ type: 'tool-start', operation: definition.operation, callId: params.callId });
    const result = turn.tools.execute(definition.operation, params.arguments, {
      runId: turn.runId,
      signal: turn.signal,
      idempotencyKey: params.callId,
    });
    call = { fingerprint, result };
    state.completedCalls.set(params.callId, call);
  }
  try {
    const value = await call.result;
    turn.signal.throwIfAborted();
    rpc.respond(id, {
      success: true,
      contentItems: [{ type: 'inputText', text: JSON.stringify(value) }],
    });
    channel.push({ type: 'tool-finish', operation: definition.operation, callId: params.callId });
  } catch {
    rpc.respond(id, {
      success: false,
      contentItems: [{ type: 'inputText', text: 'Application tool was rejected or failed' }],
    });
  }
}

function questionChoices(question: Params): string[] | undefined {
  if (question.options !== undefined && !Array.isArray(question.options))
    throw new Error('Malformed native question options');
  return Array.isArray(question.options)
    ? question.options.map((raw) => {
        const option = protocolRecord(raw, 'question option');
        if (typeof option.label !== 'string')
          throw new Error('Malformed native question option label');
        return option.label;
      })
    : undefined;
}

/** Ask the person each native question in order, offering its labels as choices. */
async function askQuestions(state: CodexTurn, id: NonNullable<RpcMessage['id']>, params: Params) {
  const answers: Record<string, { answers: string[] }> = {};
  if (!Array.isArray(params.questions) || params.questions.length > 16)
    throw new Error('Malformed native questions');
  for (const raw of params.questions) {
    const question = protocolRecord(raw, 'question');
    if (typeof question.id !== 'string' || typeof question.question !== 'string')
      throw new Error('Malformed native question');
    const choices = questionChoices(question);
    answers[question.id] = { answers: [await state.turn.question(question.question, choices)] };
  }
  state.rpc.respond(id, { answers });
}

async function handleRequest(
  state: CodexTurn,
  id: NonNullable<RpcMessage['id']>,
  method: string,
  params: Params,
) {
  if (method === 'item/tool/call') return await callTool(state, id, params);
  if (method === 'item/tool/requestUserInput') return await askQuestions(state, id, params);
  if (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval'
  )
    // This profile never elevates shell/filesystem actions through an approval.
    state.rpc.respond(id, { decision: 'decline' });
  else state.rpc.reject(id, 'Unsupported request in application-only tool profile');
}

/** End the channel when this thread's current turn completes; other completions are ignored. */
function completeTurn(state: CodexTurn, params: Params) {
  const { threadId, turnId } = state.ids();
  if (typeof params.threadId !== 'string') throw new Error('Malformed native completion thread ID');
  if (threadId && params.threadId !== threadId) return;
  const nativeTurn = protocolRecord(params.turn, 'turn completion');
  if (typeof nativeTurn.id !== 'string' || !nativeTurn.id || nativeTurn.id.length > 256)
    throw new Error('Malformed native completion turn ID');
  if (turnId && nativeTurn.id !== turnId) return;
  if (nativeTurn.status === 'completed') state.channel.end();
  else if (typeof nativeTurn.status !== 'string') throw new Error('Malformed native turn status');
  else state.channel.end(new Error(`Codex turn ended with status: ${nativeTurn.status}`));
}

/** Handle one app-server message: answer its requests, translate its notifications. */
export async function handleCodexMessage(state: CodexTurn, message: RpcMessage) {
  const params =
    message.params === undefined ? {} : protocolRecord(message.params, 'notification parameters');
  // `return await`, not `return`: the caller's catch must be attached before the rejection
  // settles, or the runtime reports it as unhandled.
  if (message.id !== undefined && message.method)
    return await handleRequest(state, message.id, message.method, params);
  if (message.method === 'item/agentMessage/delta') {
    if (typeof params.delta !== 'string') throw new Error('Malformed native text delta');
    state.channel.push({ type: 'text', text: params.delta });
  } else if (message.method === 'turn/completed') completeTurn(state, params);
  else if (message.method === 'error')
    state.channel.end(new Error('Codex reported a provider/protocol error'));
}
