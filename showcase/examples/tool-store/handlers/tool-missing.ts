import { ApplicationError } from '@agent-native/contracts';
import { records, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { tools, type Tool } from '../contracts/tool';
import type { AppState } from '../domain';
import { handler, type Context, type Services } from './context';

/**
 * Why an available tool cannot go missing. A lent tool has an open loan that only `tool.return`
 * closes, and a tool in repair or retired is not expected on the shelf.
 */
const notAvailable: Record<Exclude<Tool['status'], 'available'>, string> = {
  'checked-out': 'is checked out; return it first',
  'in-repair': 'is in repair',
  missing: 'is missing already',
  retired: 'is retired',
};

/** Change one tool's status from `from` to `to`, or refuse with CONFLICT naming its asset tag. */
function move(ctx: Context, toolId: string, from: Tool['status'], to: Tool['status']) {
  const rows = records(ctx, tools, ctx.state.tools);
  const tool = rows.getExisting(toolId, 'Tool unavailable');
  if (tool.status !== from) {
    const reason =
      from === 'available'
        ? notAvailable[tool.status as keyof typeof notAvailable]
        : `is ${tool.status}, not ${from}`;
    throw new ApplicationError('CONFLICT', `${tool.assetTag} ${reason}`, {
      id: tool.id,
      status: tool.status,
    });
  }
  return rows.update(tool.id, { status: to });
}

/** Set an available tool missing, and a missing tool available again. */
export function toolMissingHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    handler(operations.toolMarkMissing, (input, ctx) =>
      move(ctx, input.toolId, 'available', 'missing'),
    ),
    handler(operations.toolMarkFound, (input, ctx) =>
      move(ctx, input.toolId, 'missing', 'available'),
    ),
  ];
}
