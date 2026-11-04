import { ApplicationError, type InputOf } from '@tortoise/contracts';
import type { AuthorizationPort, HandlerContext, HandlerContribution } from '@tortoise/runtime';
import { stationSignInModule, stationSignInOperations as ops } from './contracts';
import { newId, type BadgeRecord, type SessionRecord, type StationSignInState } from './state';

/** What the plugin hands its handlers, from its settings. */
export interface StationSignInService {
  readonly now: () => number;
  readonly sessionMinutes: number;
}
export interface StationSignInServices {
  readonly 'station-sign-in'?: StationSignInService;
}

type Context = HandlerContext<StationSignInState, StationSignInServices>;

/** Failed PINs in a row that lock a badge, and for how long. */
export const lockout = { failures: 5, ms: 15 * 60_000 } as const;
/** Ended or expired sessions are kept this long for the list, then dropped. */
const sessionRetentionMs = 24 * 3_600_000;

function serviceOf(ctx: Context): StationSignInService {
  const service = ctx.services['station-sign-in'];
  if (!service) throw new ApplicationError('UNAVAILABLE', 'Station sign-in is not open');
  return service;
}

const publicBadge = ({
  badgeDigest: _,
  pinSalt: __,
  pinHash: ___,
  failures: ____,
  ...badge
}: BadgeRecord) => badge;
const publicSession = ({ tokenDigest: _, badgeId: __, endedAt: ___, ...session }: SessionRecord) =>
  session;
const open = (session: SessionRecord, at: number) =>
  session.endedAt === undefined && session.expiresAt > at;

function badgeOf(state: StationSignInState, id: string) {
  const badge = Object.hasOwn(state.badges, id) ? state.badges[id] : undefined;
  if (!badge) throw new ApplicationError('NOT_FOUND', 'Badge not found');
  return badge;
}

function endSession(ctx: Context, session: SessionRecord, at: number) {
  session.endedAt = at;
  ctx.change(`operator-session:${session.id}`, 'operator-session.ended');
}

function enroll(input: InputOf<typeof ops.badgeEnroll>, ctx: Context) {
  if (
    Object.values(ctx.state.badges).some(
      (badge) => badge.badgeDigest === input.badgeDigest && badge.revokedAt === undefined,
    )
  )
    throw new ApplicationError('CONFLICT', 'This badge is already enrolled');
  const badge: BadgeRecord = {
    id: newId('b'),
    principalId: input.principalId,
    label: input.label,
    badgeDigest: input.badgeDigest,
    pinSalt: input.pinSalt,
    pinHash: input.pinHash,
    enrolledBy: ctx.context.principalId,
    enrolledAt: serviceOf(ctx).now(),
    failures: 0,
  };
  ctx.state.badges[badge.id] = badge;
  ctx.change(`badge:${badge.id}`, 'badge.enrolled');
  return { badge: publicBadge(badge) };
}

/**
 * One sign-in attempt, committed whether or not it succeeds, so failures count even though the
 * caller sees a refusal. The lockout is checked here, inside the transaction, so attempts racing
 * each other cannot get past it.
 */
function start(input: InputOf<typeof ops.sessionStart>, ctx: Context) {
  const { now, sessionMinutes } = serviceOf(ctx);
  const at = now();
  const badge = badgeOf(ctx.state, input.badgeId);
  if (badge.revokedAt !== undefined) return { session: null, refusal: 'revoked' as const };
  if (badge.lockedUntil !== undefined && badge.lockedUntil > at)
    return { session: null, refusal: 'locked' as const };
  if (!input.verified) {
    badge.failures += 1;
    if (badge.failures >= lockout.failures) {
      badge.failures = 0;
      badge.lockedUntil = at + lockout.ms;
    }
    ctx.change(`badge:${badge.id}`, 'badge.sign-in-failed');
    return {
      session: null,
      refusal: badge.lockedUntil && badge.lockedUntil > at ? ('locked' as const) : ('pin' as const),
    };
  }
  if (
    Object.values(ctx.state.sessions).some((session) => session.tokenDigest === input.tokenDigest)
  )
    throw new ApplicationError('CONFLICT', 'Token already issued');
  badge.failures = 0;
  delete badge.lockedUntil;
  for (const [id, old] of Object.entries(ctx.state.sessions)) {
    // One operator per terminal: signing in ends whoever was signed in there before.
    if (
      open(old, at) &&
      old.terminalPrincipal === input.terminalPrincipal &&
      old.terminal === input.terminal
    )
      endSession(ctx, old, at);
    if (Math.min(old.endedAt ?? Infinity, old.expiresAt) + sessionRetentionMs < at) {
      delete ctx.state.sessions[id];
      ctx.change(`operator-session:${id}`, 'operator-session.dropped');
    }
  }
  const session: SessionRecord = {
    id: newId('s'),
    badgeId: badge.id,
    principalId: badge.principalId,
    terminalPrincipal: input.terminalPrincipal,
    terminal: input.terminal,
    tokenDigest: input.tokenDigest,
    startedAt: at,
    expiresAt: at + sessionMinutes * 60_000,
  };
  ctx.state.sessions[session.id] = session;
  ctx.change(`operator-session:${session.id}`, 'operator-session.started');
  return { session: publicSession(session) };
}

const findSession = (state: StationSignInState, tokenDigest: string) =>
  Object.values(state.sessions).find((session) => session.tokenDigest === tokenDigest);

export const stationSignInHandlers: HandlerContribution<
  StationSignInState,
  StationSignInServices
>[] = [
  { capability: ops.badgeEnroll, handle: async (input, ctx) => enroll(input as never, ctx) },
  {
    capability: ops.badgeRevoke,
    handle: async (input, ctx) => {
      const badge = badgeOf(ctx.state, (input as { badgeId: string }).badgeId);
      const at = serviceOf(ctx).now();
      if (badge.revokedAt === undefined) {
        badge.revokedAt = at;
        ctx.change(`badge:${badge.id}`, 'badge.revoked');
        for (const session of Object.values(ctx.state.sessions))
          if (session.badgeId === badge.id && open(session, at)) endSession(ctx, session, at);
      }
      return { badge: publicBadge(badge) };
    },
  },
  {
    capability: ops.badgeList,
    handle: async (_input, ctx) => {
      const at = serviceOf(ctx).now();
      return {
        badges: Object.values(ctx.state.badges)
          .sort((a, b) => a.enrolledAt - b.enrolledAt)
          .map(publicBadge),
        sessions: Object.values(ctx.state.sessions)
          .filter((session) => open(session, at))
          .sort((a, b) => a.startedAt - b.startedAt)
          .map(publicSession),
      };
    },
  },
  {
    capability: ops.badgeVerifier,
    handle: async (input, ctx) => {
      const { badgeDigest } = input as { badgeDigest: string };
      const badge = Object.values(ctx.state.badges).find(
        (candidate) => candidate.badgeDigest === badgeDigest && candidate.revokedAt === undefined,
      );
      return {
        badge: badge
          ? {
              id: badge.id,
              principalId: badge.principalId,
              pinSalt: badge.pinSalt,
              pinHash: badge.pinHash,
            }
          : null,
      };
    },
  },
  { capability: ops.sessionStart, handle: async (input, ctx) => start(input as never, ctx) },
  {
    capability: ops.sessionEnd,
    handle: async (input, ctx) => {
      const session = findSession(ctx.state, (input as { tokenDigest: string }).tokenDigest);
      const at = serviceOf(ctx).now();
      if (!session || !open(session, at)) return { ended: false };
      endSession(ctx, session, at);
      return { ended: true };
    },
  },
  {
    capability: ops.sessionResolve,
    handle: async (input, ctx) => {
      const session = findSession(ctx.state, (input as { tokenDigest: string }).tokenDigest);
      const at = serviceOf(ctx).now();
      // A revoked badge's sessions are already ended; checking again covers state written before.
      const live =
        session && open(session, at) && ctx.state.badges[session.badgeId]?.revokedAt === undefined;
      return { session: live ? publicSession(session) : null };
    },
  },
];

const known = new Set<string>(stationSignInModule.capabilities.map((capability) => capability.id));

/**
 * Only admins (the local user, or a caller acting for them under a grant that lists the
 * operation) call these operations. The sign-in routes and credential checks run as the local user
 * narrowed to the verifier and session operations. Badge and session events are visible to admins.
 */
export const stationSignInPolicy: AuthorizationPort<StationSignInState> = {
  authorize({ capability, context, state }) {
    if (!known.has(capability.id)) return { allowed: false, reason: 'NO_POLICY' };
    return { allowed: state.admins.includes(context.principalId), reason: 'RESOURCE_DENIED' };
  },
  canReadEvent: ({ context, state }) => state.admins.includes(context.principalId),
};
