import { ApplicationError, type InputOf } from '@tortoise/contracts';
import { own, records, type HandlerContribution } from '@tortoise/runtime';
import { operations } from '../contracts';
import { tools, type Tool } from '../contracts/tool';
import type { AppState } from '../domain';
import { handler, type Context, type Services } from './context';

/**
 * Why a tool cannot be retired, or nothing. A lent tool has an open loan that only `tool.return`
 * closes, so it comes back first.
 */
function refusal(tool: Tool) {
  if (tool.status === 'checked-out') return 'Tool is checked out; return it first';
  if (tool.status === 'retired') return 'Tool is already retired';
  return undefined;
}

/** Set a tool's status to retired. Its loans and repair orders stay as they are. */
export function toolRetireHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.toolRetire, (input, ctx) => {
      const rows = records(ctx, tools, ctx.state.tools);
      const tool = rows.getExisting(input.toolId, 'Tool unavailable');
      const reason = refusal(tool);
      if (reason)
        throw new ApplicationError('CONFLICT', reason, { id: tool.id, status: tool.status });
      return rows.update(tool.id, { status: 'retired' });
    }),
  ];
}

/**
 * The approval feature's check when an approval request is submitted: a request to retire a
 * tool that is missing, lent or already retired is refused with INVALID_INPUT, so no attendant is
 * asked to approve what `tool.retire` would refuse. Approving checks the tool again.
 */
export function checkRetireRequest(operation: string, input: unknown, ctx: Context) {
  if (operation !== operations.toolRetire.id) return;
  const { toolId } = input as InputOf<typeof operations.toolRetire>;
  const tool = own(ctx.state.tools, toolId);
  const reason = tool ? refusal(tool) : 'Tool unavailable';
  if (reason) throw new ApplicationError('INVALID_INPUT', reason, { field: 'toolId' });
}
