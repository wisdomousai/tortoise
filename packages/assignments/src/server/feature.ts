import { connectTarget, type SystemOfRecordPort } from '@agent-native/integration';
import { defineFeature, type ConnectContext, type Feature } from '@agent-native/kernel';
import type { AnyAssignmentKind } from '../kind';
import type { Assignments } from '../manifest';
import { kindsById, type AssignmentAccess, type AssignmentHooks } from './hooks';
import { genericIssueHandlers, kindIssueHandlers } from './issue';
import { assignmentPolicy } from './policy';
import { genericReportHandlers, kindReportHandlers } from './report';
import { createSlice, type AssignmentSlice } from './slice';
import { targetLaneHandlers, type TargetAnswer } from './target-lane';
import type { OfferBlob } from './target-port';

/** What a target lane's port is built from: the connect context and a reader of offer blobs. */
export interface TargetLaneContext extends ConnectContext {
  readBlob(effectId: string, digest: string): Promise<OfferBlob | undefined>;
}

/** How one target lane connects. */
export interface TargetLaneOptions {
  /** The integration principal that settles the lane's offers and syncs its answers. */
  readonly principalId: string;
  /** The lane's port, usually `assignmentTargetPort`. */
  readonly port: (context: TargetLaneContext) => SystemOfRecordPort<TargetAnswer>;
}

export interface AssignmentFeatureOptions {
  /** One entry per target lane the kinds declare; a lane without one is not connected. */
  readonly targets?: Readonly<Record<string, TargetLaneOptions>>;
}

/**
 * Assignments as a feature: the server part of `defineAssignments`. The slice keeps assignments,
 * reports and each target lane's watermark. The application supplies `AssignmentAccess` and,
 * optionally, `AssignmentHooks` when it mounts it. Accepting a report is person-only for every
 * application, and a target lane's settle and sync are for its integration principal only.
 */
export function assignmentFeature<K extends AnyAssignmentKind>(
  assignments: Assignments<K>,
  options: AssignmentFeatureOptions = {},
): Feature<AssignmentSlice, AssignmentAccess, AssignmentHooks> {
  const kinds = kindsById(assignments.kinds);
  const lanes = Object.keys(assignments.targets);
  const connected = options.targets ?? {};
  for (const lane of Object.keys(connected))
    if (!lanes.includes(lane)) throw new Error(`No assignment kind has the target lane "${lane}"`);
  const principals = Object.fromEntries(
    Object.entries(connected).map(([lane, target]) => [lane, target.principalId]),
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
      ...lanes.flatMap((lane) => targetLaneHandlers(lane, assignments.targets[lane]!, kinds)),
    ],
    authorization: {
      resourceTypes: ['assignment', 'assignment-report'],
      port: assignmentPolicy(new Set(kinds.keys()), new Set(lanes), principals),
    },
    ...(Object.keys(connected).length
      ? {
          connect: (context: ConnectContext) => ({
            integrations: Object.entries(connected).map(([lane, target]) =>
              connectTarget<TargetAnswer>({
                target: assignments.targets[lane]!,
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
