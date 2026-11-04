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

export interface RouteOptions {
  /** Principals whose screens are station terminals; the local owner always is. */
  readonly terminals: ReadonlySet<string>;
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
async function signIn(
  request: Request,
  terminal: ExecutionContext,
  caller: StationCaller,
  options: RouteOptions,
) {
  if (terminal.grant)
    throw new ApplicationError('FORBIDDEN', 'A delegated caller cannot sign people in');
  if (!options.terminals.has(terminal.principalId))
    throw new ApplicationError('FORBIDDEN', 'This caller is not a station terminal');
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

async function signOut(request: Request, caller: StationCaller) {
  const body = await readJsonBody(request);
  const token = text(body.token, 64);
  if (!token) throw invalid('token is required');
  const receipt = await caller.application.invokeRaw(
    command(ops.sessionEnd.id, { tokenDigest: digestOf(token) }),
    { ...caller.context, channel: 'http' },
  );
  return jsonResponse(receipt.result);
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
  if (pathname === stationPaths.signOut) return signOut(request, caller);
  return enroll(request, context, caller);
}
