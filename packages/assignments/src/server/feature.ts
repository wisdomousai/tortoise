import { connectTarget, type SystemOfRecordPort } from '@tortoise/integration';
import { defineFeature, type ConnectContext, type Feature } from '@tortoise/kernel';
import type { AnyAssignmentKind } from '../kind';
import type { Assignments } from '../manifest';
import { kindsById, type AssignmentAccess, type AssignmentHooks } from './hooks';
import { genericIssueHandlers, kindIssueHandlers } from './issue';
import { assignmentPolicy } from './policy';
import { genericReportHandlers, kindReportHandlers } from './report';
import { createSlice, type AssignmentSlice } from './slice';
import { assignmentTargetHandlers, type TargetResult } from './assignment-target';
import type { OfferBlob } from './target-port';

/** What an assignment target's port is built from: the connect context and a reader of offer blobs. */
export interface AssignmentTargetContext extends ConnectContext {
  readBlob(effectId: string, digest: string): Promise<OfferBlob | undefined>;
}

/** How one assignment target connects. */
export interface AssignmentTargetOptions {
  /** The integration principal that completes the target's offers and syncs its results. */
  readonly principalId: string;
  /** The target's port, usually `assignmentTargetPort`. */
  readonly port: (context: AssignmentTargetContext) => SystemOfRecordPort<TargetResult>;
}

export interface AssignmentFeatureOptions {
  /** One entry per assignment target the kinds declare; a target without one is not connected. */
  readonly targets?: Readonly<Record<string, AssignmentTargetOptions>>;
}

/**
 * Assignments as a feature: the server part of `defineAssignments`. The slice keeps assignments,
 * reports and each assignment target's watermark. The application supplies `AssignmentAccess` and,
 * optionally, `AssignmentHooks` when it mounts it. Accepting a report is person-only for every
 * application, and an assignment target's complete and sync are for its integration principal only.
 */
export function assignmentFeature<K extends AnyAssignmentKind>(
  assignments: Assignments<K>,
  options: AssignmentFeatureOptions = {},
): Feature<AssignmentSlice, AssignmentAccess, AssignmentHooks> {
  const kinds = kindsById(assignments.kinds);
  const targets = Object.keys(assignments.targets);
  const connected = options.targets ?? {};
  for (const name of Object.keys(connected))
    if (!targets.includes(name)) throw new Error(`No assignment kind has the target "${name}"`);
  const principals = Object.fromEntries(
    Object.entries(connected).map(([name, target]) => [name, target.principalId]),
  );
  const erased = assignments as unknown as Assignments;
  return defineFeature<AssignmentSlice, AssignmentAccess, AssignmentHooks>({
    manifest: assignments.manifest,
    state: { create: createSlice, migrations: { version: 1 } },
    handlers: () => [
      ...assignments.kinds.flatMap((kind) => [
        ...kindIssueHandlers(erased, kind),
        ...kindReportHandlers(erased, kind),
      ]),
      ...genericIssueHandlers(erased),
      ...genericReportHandlers(erased),
      ...targets.flatMap((name) =>
        assignmentTargetHandlers(name, assignments.targets[name]!, kinds),
      ),
    ],
    authorization: {
      resourceTypes: ['assignment', 'assignment-report'],
      port: assignmentPolicy(new Set(kinds.keys()), new Set(targets), principals),
    },
    ...(Object.keys(connected).length
      ? {
          connect: (context: ConnectContext) => ({
            integrations: Object.entries(connected).map(([name, target]) =>
              connectTarget<TargetResult>({
                target: assignments.targets[name]!,
                application: context.application,
                workspaceId: context.workspaceId,
                principalId: target.principalId,
                port: target.port({
                  ...context,
                  readBlob: (effectId, digest) =>
                    context.application.readEffectBlob(context.workspaceId, effectId, digest),
                }),
              }),
            ),
          }),
        }
      : {}),
  });
}
