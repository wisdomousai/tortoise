import type { z } from 'zod';
import { ApplicationError } from '@tortoise/contracts';
import { own } from '@tortoise/runtime';
import type { StoredAssignment, StoredReport } from '@tortoise/assignments/server';
import { operations } from '../contracts';
import { cycleCount, maxCountedTools } from '../contracts/cycle-count-assignment';
import type { AppState } from '../domain';
import type { Context } from './context';

type Body = Readonly<Record<string, unknown>>;
type Count = z.output<typeof cycleCount.report>;
const binOf = (scope: Body) => scope.bin as string;
const invalid = (message: string, details: Record<string, string>) =>
  new ApplicationError('INVALID_INPUT', message, details);

/** The tools a count of `bin` covers, by asset tag: every tool there except retired ones. */
const counted = (state: AppState, bin: string) =>
  Object.values(state.tools)
    .filter((tool) => tool.bin === bin && tool.status !== 'retired')
    .sort((a, b) => (a.assetTag < b.assetTag ? -1 : a.assetTag > b.assetTag ? 1 : 0));

/**
 * The cycle count hooks, which the assignment feature calls inside its commands. The scope names
 * a bin that holds tools, the assignee is an attendant, and the brief lists the bin's tools with
 * their status when the count is sent. Reports name no record; the accept hook checks each tag.
 */
export const cycleCountHooks = {
  scope(scope: Body, ctx: Context) {
    const bin = binOf(scope);
    const tools = counted(ctx.state, bin).length;
    if (tools === 0) throw invalid(`No tool is in bin ${bin}`, { field: 'scope' });
    if (tools > maxCountedTools)
      throw invalid(`Bin ${bin} holds more than ${maxCountedTools} tools`, { field: 'scope' });
  },
  // Viewers only read counts, so a count sent to one could never be worked.
  assignee(assignee: { readonly type: string; readonly id: string }, ctx: Context) {
    if (own(ctx.state.members, assignee.id) !== 'attendant')
      throw invalid(`${assignee.id} is not an attendant`, { field: 'assignee' });
  },
  brief(assignment: Readonly<StoredAssignment>, ctx: Context) {
    const bin = binOf(assignment.scope);
    return {
      bin,
      tools: counted(ctx.state, bin).map(({ assetTag, status }) => ({ assetTag, status })),
    };
  },
  /**
   * Write an accepted report through the tool commands, as the attendant accepting it, in the
   * accept's transaction. Every tag is checked against the tools in the bin now, not the brief,
   * before anything changes. A tool reported missing that is missing already, and a found tool
   * that was not missing, stay as they are. `tool.mark-missing` refuses a tool that is not
   * available, such as a checked-out one. Any refusal fails the whole accept, so the report stays
   * new and no tool changes.
   */
  async accept(
    report: Readonly<StoredReport>,
    _input: Body,
    assignment: Readonly<StoredAssignment>,
    ctx: Context,
  ) {
    const bin = binOf(assignment.scope);
    const { found, missing } = report.body as Count;
    const both = found.find((tag) => missing.includes(tag));
    if (both) throw invalid(`${both} is reported both found and missing`, { assetTag: both });
    const inBin = new Map(
      Object.values(ctx.state.tools)
        .filter((tool) => tool.bin === bin)
        .map((tool) => [tool.assetTag, tool]),
    );
    const toolOf = (tag: string) => {
      const tool = inBin.get(tag);
      if (!tool) throw invalid(`${tag} is not in bin ${bin}`, { assetTag: tag });
      return tool;
    };
    const lost = [...new Set(missing)].map(toolOf);
    const back = [...new Set(found)].map(toolOf);
    for (const { id, status } of lost)
      if (status !== 'missing') await ctx.invoke(operations.toolMarkMissing, { toolId: id });
    for (const { id, status } of back)
      if (status === 'missing') await ctx.invoke(operations.toolMarkFound, { toolId: id });
  },
};
