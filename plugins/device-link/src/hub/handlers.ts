import { ApplicationError, type InputOf } from '@agent-native/contracts';
import type { AuthorizationPort, HandlerContext, HandlerContribution } from '@agent-native/runtime';
import { deviceLinkModule, deviceLinkOperations as ops } from '../contracts';
import {
  credentialDigest as digestOf,
  newEnrollmentCode,
  normalizeCode,
} from '@agent-native/host/enrollment';
import { newId, type DeviceLinkState, type DeviceRecord } from './state';

/** What the hub plugin hands its handlers, from its settings and the composed catalog. */
export interface DeviceLinkService {
  readonly now: () => number;
  /** Every operation in the deployment's catalog, to check an attached device's operations. */
  readonly operations: ReadonlySet<string>;
}
export interface DeviceLinkServices {
  readonly 'device-link'?: DeviceLinkService;
}

type Context = HandlerContext<DeviceLinkState, DeviceLinkServices>;

export const enrollmentLifetimeMs = 10 * 60_000;
/** Used or expired enrollments are kept this long for the list, then dropped. */
const enrollmentRetentionMs = 24 * 3_600_000;

function serviceOf(ctx: Context): DeviceLinkService {
  const service = ctx.services['device-link'];
  if (!service) throw new ApplicationError('UNAVAILABLE', 'Device link is not open');
  return service;
}

const publicDevice = ({ tokenDigest: _, operations: __, ...device }: DeviceRecord) => device;

function deviceOf(state: DeviceLinkState, id: string) {
  const device = Object.hasOwn(state.devices, id) ? state.devices[id] : undefined;
  if (!device) throw new ApplicationError('NOT_FOUND', 'Device not found');
  return device;
}

function createEnrollment(input: InputOf<typeof ops.enrollmentCreate>, ctx: Context) {
  const { now, operations } = serviceOf(ctx);
  if (input.kind === 'field-sync' && input.operations)
    throw new ApplicationError(
      'INVALID_INPUT',
      'Field devices use the sync operations the hub settings name; operations apply to attached devices',
    );
  const unknown = (input.operations ?? []).filter((operation) => !operations.has(operation));
  if (unknown.length)
    throw new ApplicationError('INVALID_INPUT', `Unknown operations: ${unknown.join(', ')}`);
  // A device never manages devices: a tablet that could enroll or revoke would outlive its own
  // revocation by enrolling another.
  const managing = (input.operations ?? []).filter((operation) => known.has(operation));
  if (managing.length)
    throw new ApplicationError(
      'INVALID_INPUT',
      `Devices cannot be granted device management: ${managing.join(', ')}`,
    );
  const at = now();
  for (const [id, old] of Object.entries(ctx.state.enrollments))
    if (Math.max(old.expiresAt, old.redeemedAt ?? 0) + enrollmentRetentionMs < at) {
      delete ctx.state.enrollments[id];
      ctx.change(`enrollment:${id}`, 'enrollment.dropped');
    }
  const code = newEnrollmentCode();
  const id = newId('e');
  ctx.state.enrollments[id] = {
    id,
    label: input.label,
    kind: input.kind,
    createdBy: ctx.context.principalId,
    createdAt: at,
    expiresAt: at + enrollmentLifetimeMs,
    codeDigest: digestOf(code),
    ...(input.operations ? { operations: [...input.operations] } : {}),
  };
  ctx.change(`enrollment:${id}`, 'enrollment.created');
  // The code is returned once; the state keeps only its digest.
  return { enrollmentId: id, code, expiresAt: at + enrollmentLifetimeMs };
}

function redeem(input: InputOf<typeof ops.enrollmentRedeem>, ctx: Context) {
  const at = serviceOf(ctx).now();
  const codeDigest = digestOf(normalizeCode(input.code));
  const enrollment = Object.values(ctx.state.enrollments).find(
    (candidate) => candidate.codeDigest === codeDigest,
  );
  // One message for every failure, so a caller cannot tell a used code from a wrong one.
  if (!enrollment || enrollment.redeemedAt !== undefined || enrollment.expiresAt <= at)
    throw new ApplicationError('FORBIDDEN', 'Enrollment code is invalid, expired or already used');
  if (Object.values(ctx.state.devices).some((device) => device.tokenDigest === input.tokenDigest))
    throw new ApplicationError('CONFLICT', 'Credential already issued');
  const device: DeviceRecord = {
    id: newId('d'),
    label: enrollment.label,
    kind: enrollment.kind,
    enrolledBy: enrollment.createdBy,
    enrolledAt: at,
    tokenDigest: input.tokenDigest,
    ...(enrollment.operations ? { operations: [...enrollment.operations] } : {}),
  };
  ctx.state.devices[device.id] = device;
  enrollment.redeemedAt = at;
  enrollment.deviceId = device.id;
  ctx.change(`device:${device.id}`, 'device.enrolled');
  ctx.change(`enrollment:${enrollment.id}`, 'enrollment.redeemed');
  return { device: publicDevice(device) };
}

export const deviceLinkHandlers: HandlerContribution<DeviceLinkState, DeviceLinkServices>[] = [
  {
    capability: ops.enrollmentCreate,
    handle: async (input, ctx) => createEnrollment(input as never, ctx),
  },
  { capability: ops.enrollmentRedeem, handle: async (input, ctx) => redeem(input as never, ctx) },
  {
    capability: ops.deviceList,
    handle: async (_input, ctx) => ({
      devices: Object.values(ctx.state.devices)
        .sort((a, b) => a.enrolledAt - b.enrolledAt)
        .map(publicDevice),
      enrollments: Object.values(ctx.state.enrollments)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ codeDigest: _, operations: __, createdBy: ___, ...enrollment }) => enrollment),
    }),
  },
  {
    capability: ops.deviceRevoke,
    handle: async (input, ctx) => {
      const device = deviceOf(ctx.state, (input as { deviceId: string }).deviceId);
      if (device.revokedAt === undefined) {
        device.revokedAt = serviceOf(ctx).now();
        ctx.change(`device:${device.id}`, 'device.revoked');
      }
      return { device: publicDevice(device) };
    },
  },
  {
    capability: ops.deviceRename,
    handle: async (input, ctx) => {
      const { deviceId, label } = input as { deviceId: string; label: string };
      const device = deviceOf(ctx.state, deviceId);
      device.label = label;
      ctx.change(`device:${device.id}`, 'device.renamed');
      return { device: publicDevice(device) };
    },
  },
  {
    capability: ops.credentialResolve,
    handle: async (input, ctx) => {
      const { tokenDigest } = input as { tokenDigest: string };
      const device = Object.values(ctx.state.devices).find(
        (candidate) => candidate.tokenDigest === tokenDigest && candidate.revokedAt === undefined,
      );
      return {
        device: device
          ? {
              ...publicDevice(device),
              ...(device.operations ? { operations: [...device.operations] } : {}),
            }
          : null,
      };
    },
  },
];

const known = new Set<string>(deviceLinkModule.capabilities.map((capability) => capability.id));

/**
 * Only admins (the local owner, or a caller acting for them under a grant that lists the
 * operation) manage devices. The enrollment route and credential lookups run as the owner
 * narrowed to exactly those two operations. Device and enrollment events are visible to admins.
 */
export const deviceLinkPolicy: AuthorizationPort<DeviceLinkState> = {
  authorize({ capability, context, state }) {
    if (!known.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    return { allowed: state.admins.includes(context.principalId), reason: 'RESOURCE_DENIED' };
  },
  canReadEvent: ({ context, state }) => state.admins.includes(context.principalId),
};
