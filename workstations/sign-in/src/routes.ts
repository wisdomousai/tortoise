import { ApplicationError } from '@tortoise/contracts';
import { jsonResponse, readJsonBody } from '@tortoise/adapters/http';
import type { HostedApplication } from '@tortoise/kernel/application';
import type { ExecutionContext } from '@tortoise/runtime';
import { stationPaths, stationSignInOperations as ops } from './contracts';
import { digestOf, newOperatorToken, pinMatches, pinVerifier } from './state';

/** What the routes need once the host listens; undefined before `start`. */
export interface StationCaller {
  readonly application: HostedApplication;
  readonly workspaceId: string;
  /** The local owner narrowed to the verifier and session operations. */
  readonly context: ExecutionContext;
}

/**
 * One abort signal per open operator session, by token digest. A request runs with its session's
 * signal, so a sign-out or the session's expiry stops it at the runtime's next check.
 */
export class OperatorSignals {
  private open = new Map<string, { controller: AbortController; expiresAt: number }>();
  constructor(private readonly now: () => number) {}
  signal(digest: string, expiresAt: number): AbortSignal {
    for (const [key, entry] of this.open) if (entry.expiresAt <= this.now()) this.open.delete(key);
    let entry = this.open.get(digest);
    if (!entry) this.open.set(digest, (entry = { controller: new AbortController(), expiresAt }));
    // A timer holds at most 2^31 - 1 ms; the resolve at the next request catches a later expiry.
    const remaining = Math.max(0, expiresAt - this.now());
    return remaining < 2 ** 31
      ? AbortSignal.any([entry.controller.signal, AbortSignal.timeout(remaining)])
      : entry.controller.signal;
  }
  end(digest: string) {
    this.open.get(digest)?.controller.abort(new ApplicationError('CANCELLED', 'Signed out'));
    this.open.delete(digest);
  }
}

export interface RouteOptions {
  /** Principals whose screens are station terminals; the local owner always is. */
  readonly terminals: ReadonlySet<string>;
  readonly signals: OperatorSignals;
}

const pinPattern = /^\d{4,8}$/;
const terminalPattern = /^[a-z0-9-]{1,64}$/;
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
const invalid = (message: string) => new ApplicationError('INVALID_INPUT', message);
// One message for an unknown badge, a revoked one and a wrong PIN.
const notRecognized = () => new ApplicationError('FORBIDDEN', 'Badge or PIN not recognized');
const command = (operation: string, input: unknown) => ({
  operation,
  input,
  idempotencyKey: `station:${crypto.randomUUID()}`,
});

/**
 * POST sign-in `{ badge, pin, terminal }`, from the terminal screen's own session:
 *
 * 1. Only a terminal may sign people in, and never under a delegated grant, so an agent working at
 *    the terminal cannot open a person's session.
 * 2. The badge's PIN verifier is read and the PIN checked here, so the PIN never reaches a stored
 *    command input; then `station.session.start` records the attempt and applies the lockout.
 * 3. The operator token is generated here and returned once; state keeps only its digest.
 */
/** Only a terminal acts at a terminal, and never under a delegated grant. */
function assertTerminal(terminal: ExecutionContext, options: RouteOptions) {
  if (terminal.grant)
    throw new ApplicationError('FORBIDDEN', 'A delegated caller cannot sign people in');
  if (!options.terminals.has(terminal.principalId))
    throw new ApplicationError('FORBIDDEN', 'This caller is not a station terminal');
}

async function signIn(
  request: Request,
  terminal: ExecutionContext,
  caller: StationCaller,
  options: RouteOptions,
) {
  assertTerminal(terminal, options);
  const body = await readJsonBody(request);
  const badge = text(body.badge, 256);
  const pin = typeof body.pin === 'string' && pinPattern.test(body.pin) ? body.pin : undefined;
  const terminalName =
    typeof body.terminal === 'string' && terminalPattern.test(body.terminal)
      ? body.terminal
      : undefined;
  if (!badge || !terminalName) throw invalid('badge and terminal are required');
  const context = { ...caller.context, channel: 'http' as const };
  const found = await caller.application.queryRaw(
    { operation: ops.badgeVerifier.id, input: { badgeDigest: digestOf(badge) } },
    context,
  );
  const verifier = (
    found.data as { badge: { id: string; pinSalt: string; pinHash: string } | null }
  ).badge;
  if (!verifier) throw notRecognized();
  const token = newOperatorToken();
  const receipt = await caller.application.invokeRaw(
    command(ops.sessionStart.id, {
      badgeId: verifier.id,
      verified: pin !== undefined && pinMatches(pin, verifier),
      terminalPrincipal: terminal.principalId,
      terminal: terminalName,
      tokenDigest: digestOf(token),
    }),
    context,
  );
  const { session, refusal } = receipt.result as { session: unknown; refusal?: string };
  if (refusal === 'locked')
    throw new ApplicationError('FORBIDDEN', 'This badge is locked after too many wrong PINs');
  if (!session) throw notRecognized();
  return jsonResponse({ token, session }, 201, { 'Cache-Control': 'no-store' });
}

async function signOut(request: Request, caller: StationCaller, options: RouteOptions) {
  const body = await readJsonBody(request);
  const token = text(body.token, 64);
  if (!token) throw invalid('token is required');
  const receipt = await caller.application.invokeRaw(
    command(ops.sessionEnd.id, { tokenDigest: digestOf(token) }),
    { ...caller.context, channel: 'http' },
  );
  options.signals.end(digestOf(token));
  return jsonResponse(receipt.result);
}

/**
 * POST session `{ token, terminal }`: the open operator session a terminal screen kept across a
 * reload, so the operator stays signed in. It answers only the terminal that signed the operator
 * in, under the same terminal name; any other caller, or an ended session, gets `NOT_FOUND`.
 */
async function restore(
  request: Request,
  terminal: ExecutionContext,
  caller: StationCaller,
  options: RouteOptions,
) {
  assertTerminal(terminal, options);
  const body = await readJsonBody(request);
  const token = text(body.token, 64);
  if (!token || typeof body.terminal !== 'string') throw invalid('token and terminal are required');
  const found = await caller.application.queryRaw(
    { operation: ops.sessionResolve.id, input: { tokenDigest: digestOf(token) } },
    { ...caller.context, channel: 'http' },
  );
  const session = (
    found.data as { session: { terminalPrincipal: string; terminal: string } | null }
  ).session;
  if (
    !session ||
    session.terminalPrincipal !== terminal.principalId ||
    session.terminal !== body.terminal
  )
    throw new ApplicationError('NOT_FOUND', 'No open session at this terminal');
  return jsonResponse({ session }, 200, { 'Cache-Control': 'no-store' });
}

/** POST enroll: hashes the PIN, then enrolls as the caller, whose instance the policy checks. */
async function enroll(request: Request, admin: ExecutionContext, caller: StationCaller) {
  const body = await readJsonBody(request);
  const badge = text(body.badge, 256);
  if (!badge) throw invalid('badge is required');
  if (typeof body.pin !== 'string' || !pinPattern.test(body.pin))
    throw invalid('pin must be 4 to 8 digits');
  const receipt = await caller.application.invokeRaw(
    command(ops.badgeEnroll.id, {
      principalId: body.principalId,
      label: body.label,
      badgeDigest: digestOf(badge),
      ...pinVerifier(body.pin),
    }),
    admin,
  );
  return jsonResponse(receipt.result, 201);
}

/** The plugin's authenticated routes; undefined for every other request. */
export async function stationRoute(
  request: Request,
  context: ExecutionContext,
  caller: StationCaller | undefined,
  options: RouteOptions,
): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  if (request.method !== 'POST' || !Object.values<string>(stationPaths).includes(pathname))
    return undefined;
  if (!caller) throw new ApplicationError('UNAVAILABLE', 'The station is starting');
  if (pathname === stationPaths.signIn) return signIn(request, context, caller, options);
  if (pathname === stationPaths.signOut) return signOut(request, caller, options);
  if (pathname === stationPaths.session) return restore(request, context, caller, options);
  return enroll(request, context, caller);
}
