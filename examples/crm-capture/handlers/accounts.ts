import { ApplicationError } from '@agent-native/contracts';
import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { coversRegion, visibleAccount, type CrmState } from '../domain';
import { accountDto, compact, handler, TARGET, type CrmServices } from './context';

/** Local reads of followed and adopted accounts, region-scoped before anything is counted. */
export const accountHandlers = (): HandlerContribution<CrmState, CrmServices>[] => [
  handler(operations.accountList, (input, ctx) => ({
    // Region scope first, then the status filter: nothing outside the caller's regions counts.
    items: Object.values(ctx.state.accounts)
      .filter((account) => coversRegion(ctx.state, ctx.context.principalId, account.region))
      .filter((account) => !input.status || account.status === input.status)
      .sort((a, b) => b.adoptedAt - a.adoptedAt)
      .map((account) => accountDto(ctx.state, account)),
  })),
  handler(operations.accountGet, (input, ctx) => {
    const account = visibleAccount(ctx.state, ctx.context.principalId, input.id);
    if (!account) throw new ApplicationError('NOT_FOUND', 'Account unavailable');
    const history = Object.values(ctx.state.activities)
      .filter((activity) => activity.accountId === account.id)
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .map(({ effectId: _effectId, recordedAt: _recordedAt, ...activity }) => compact(activity));
    return { ...accountDto(ctx.state, account), history };
  }),
  handler(operations.syncStatus, (_input, ctx) => {
    const accounts = Object.values(ctx.state.accounts).filter((account) =>
      coversRegion(ctx.state, ctx.context.principalId, account.region),
    );
    const count = (status: string) =>
      accounts.filter((account) => account.status === status).length;
    return compact({
      following: count('following'),
      adopted: count('adopted'),
      rejected: count('rejected'),
      pending: ctx.effects({ status: 'pending', target: TARGET }).length,
      lastSyncAt: ctx.state.lastSyncAt,
      watermark: ctx.state.watermark,
    });
  }),
];
