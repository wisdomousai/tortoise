import { ApplicationError } from '@agent-native/contracts';
import { collectionListHandler, type HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import { accounts } from '../contracts/collections';
import { coversRegion, visibleAccount, type CrmState, type LocalAccount } from '../domain';
import { accountDto, compact, handler, type CrmServices } from './context';

/** Local reads of followed and adopted accounts, region-scoped before anything is counted. */
export const accountHandlers = (): HandlerContribution<CrmState, CrmServices>[] => [
  // Region scope first, then the status filter: nothing outside the caller's regions counts.
  collectionListHandler<CrmState, CrmServices, typeof operations.accountList, LocalAccount>(
    accounts,
    operations.accountList,
    {
      store: (state) => state.accounts,
      visible: (account, ctx) => coversRegion(ctx.state, ctx.context.principalId, account.region),
      present: (account, ctx) => accountDto(ctx.state, account),
      order: (a, b) => b.adoptedAt - a.adoptedAt,
    },
  ),
  handler(operations.accountGet, (input, ctx) => {
    const account = visibleAccount(ctx.state, ctx.context.principalId, input.id);
    if (!account) throw new ApplicationError('NOT_FOUND', 'Account unavailable');
    const history = Object.values(ctx.state.activities)
      .filter((activity) => activity.accountId === account.id)
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .map(({ effectId: _effectId, recordedAt: _recordedAt, ...activity }) => compact(activity));
    return { ...accountDto(ctx.state, account), history };
  }),
];
