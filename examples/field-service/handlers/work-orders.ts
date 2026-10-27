import { randomUUID } from 'node:crypto';
import { ApplicationError } from '@agent-native/contracts';
import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { ServiceState, WorkOrder } from '../domain';
import { workOrderRole } from '../policy';
import { dto, handler, page, workOrder, put, type WorkOrderServices } from '../server/context';

/** Work orders and their membership; a membership change is an authorization change. */
export const workOrderHandlers = (): HandlerContribution<ServiceState, WorkOrderServices>[] => [
  handler(operations.workOrderCreate, (input, ctx) => {
    const id = (ctx.services.newId ?? randomUUID)();
    if (Object.hasOwn(ctx.state.workOrders, id))
      throw new ApplicationError('CONFLICT', 'Identifier already exists');
    const value: WorkOrder = {
      id,
      name: input.name,
      ...(input.site ? { site: input.site } : {}),
      closed: false,
      members: { [ctx.context.principalId]: 'dispatcher' },
    };
    put(ctx.state.workOrders, id, value);
    ctx.change(`work-order:${id}`, 'authorization.changed');
    return dto(value, ctx, true);
  }),
  handler(operations.workOrderGet, (input, ctx) => dto(workOrder(ctx.state, input.id), ctx)),
  handler(operations.workOrderList, (input, ctx) =>
    page(
      Object.values(ctx.state.workOrders)
        .filter(
          (value) =>
            workOrderRole(ctx.state, ctx.context.principalId, value.id) &&
            (!ctx.context.grant?.resources ||
              ctx.context.grant.resources.includes(`work-order:${value.id}`)) &&
            (input.closed === undefined || input.closed === value.closed),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((value) => dto(value, ctx)),
      input,
    ),
  ),
  handler(operations.workOrderClose, (input, ctx) => {
    const value = workOrder(ctx.state, input.id);
    value.closed = true;
    ctx.change(`work-order:${value.id}`);
    return dto(value, ctx, true);
  }),
  handler(operations.workOrderReopen, (input, ctx) => {
    const value = workOrder(ctx.state, input.id);
    value.closed = false;
    ctx.change(`work-order:${value.id}`);
    return dto(value, ctx, true);
  }),
  handler(operations.workOrderSetMember, (input, ctx) => {
    const value = workOrder(ctx.state, input.id);
    if (input.principalId === ctx.state.workspaceOwnerId)
      throw new ApplicationError('FORBIDDEN', 'Workspace owner membership is fixed');
    if (input.role === null) delete value.members[input.principalId];
    else
      Object.defineProperty(value.members, input.principalId, {
        value: input.role,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    ctx.change(`work-order:${value.id}`, 'authorization.changed');
    return dto(value, ctx, true);
  }),
];
