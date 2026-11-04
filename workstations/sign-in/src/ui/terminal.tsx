import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { LogOut } from 'lucide-react';
import { stationPaths } from '../contracts';
import { OperatorSessionProvider, type OperatorSessionRecord } from './operator-session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NumericPad } from '@/components/numeric-pad';
import { OperatorHeader, OperatorSurface } from '@/components/operator-surface';
import { ScanPrompt, type ScanOutcome } from '@/components/scan-prompt';
import { useIdleReturn } from '@/hooks/use-idle-return';
import { useScanner } from '@/hooks/use-scanner';

export interface TerminalOptions {
  /** The terminal's name, which the session and the audit log record. */
  readonly terminal: string;
  /** What a signed-in operator works on. It reads the operator's client with `useOperatorSession`. */
  readonly work: ComponentType;
  /** Inactivity after which the terminal signs the operator out; two minutes by default. */
  readonly idleMs?: number;
  /** The badge format, as a regular expression whose group 1, when present, is the badge value. */
  readonly badgePattern?: string;
}

interface SignedIn {
  readonly token: string;
  readonly session: OperatorSessionRecord;
}

/** POST to a station route with the terminal's own session cookie. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => undefined)) as
    (T & { error?: { message?: string } }) | undefined;
  if (!response.ok)
    throw new Error(payload?.error?.message ?? `The station route returned ${response.status}`);
  return payload as T;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { timeStyle: 'short' });

/**
 * The operator token survives a reload in this tab's session storage, which the browser clears
 * when the tab closes. Storage can be off or full; then a reload signs the operator out.
 */
const storageKey = (terminal: string) => `tortoise.station.${terminal}`;
function kept(terminal: string): string | undefined {
  try {
    return sessionStorage.getItem(storageKey(terminal)) ?? undefined;
  } catch {
    return undefined;
  }
}
function keep(terminal: string, token: string | undefined) {
  try {
    if (token) sessionStorage.setItem(storageKey(terminal), token);
    else sessionStorage.removeItem(storageKey(terminal));
  } catch {
    // The token then lasts as long as the page.
  }
}

/** Badge, then PIN. The badge value stays in this component until the sign-in request returns. */
function SignIn({
  terminal,
  badgePattern,
  onSignedIn,
}: {
  terminal: string;
  badgePattern: string;
  onSignedIn: (signedIn: SignedIn) => void;
}) {
  const [badge, setBadge] = useState<string>();
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [last, setLast] = useState<ScanOutcome>();
  const [error, setError] = useState<string>();
  const routes = useMemo(() => [{ intent: 'badge', pattern: badgePattern }], [badgePattern]);
  const accept = (value: string) => {
    setBadge(value);
    setError(undefined);
    setLast(undefined);
  };
  useScanner({
    routes,
    enabled: badge === undefined,
    onRoute: (routed) => accept(routed.value),
    onScan: (scan) => {
      if (!new RegExp(badgePattern, 'u').test(scan.data))
        setLast({ value: scan.data, ok: false, message: 'Not a badge' });
    },
  });
  const signIn = (entry: string) => {
    if (!badge) return;
    setPending(true);
    post<SignedIn>(stationPaths.signIn, { badge, pin: entry, terminal })
      .then((signedIn) => {
        setBadge(undefined);
        onSignedIn(signedIn);
      })
      .catch((failure: Error) => setError(failure.message))
      .finally(() => {
        setPin('');
        setPending(false);
      });
  };

  if (badge === undefined)
    return (
      <div className="space-y-(--operator-gap)">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <ScanPrompt
          prompt="Scan your badge"
          hint="Or type the badge number."
          last={last}
          onManual={accept}
        />
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-md space-y-(--operator-gap)">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <NumericPad
        label="PIN"
        value={pin}
        onChange={setPin}
        onSubmit={(_, entry) => signIn(entry)}
        submitLabel="Sign in"
        pending={pending}
        code
        masked
        maxLength={8}
      />
      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setBadge(undefined);
          setPin('');
        }}
      >
        Scan another badge
      </Button>
    </div>
  );
}

/**
 * A terminal at a shared workstation. Signed out, it reads a badge from the scanner or by hand and a
 * PIN from the keypad, and signs in at the station route with the terminal's own session. Signed in,
 * it shows `work` as the operator until sign-out, inactivity, the session's expiry or a rejected
 * credential returns it to sign-in. After a reload it asks the host for the session the kept token
 * names at this terminal, and shows sign-in when the session has ended.
 */
export function TerminalScreen({
  terminal,
  work: Work,
  idleMs = 120_000,
  badgePattern = '^(.{1,256})$',
}: TerminalOptions) {
  const [signedIn, setSignedIn] = useState<SignedIn>();
  const [restoring, setRestoring] = useState(() => kept(terminal) !== undefined);
  const signOut = useCallback(() => setSignedIn(undefined), []);
  useEffect(() => {
    const token = kept(terminal);
    if (!token) return;
    let current = true;
    post<{ session: OperatorSessionRecord }>(stationPaths.session, { token, terminal })
      .then(({ session }) => current && setSignedIn({ token, session }))
      .catch(() => keep(terminal, undefined))
      .finally(() => current && setRestoring(false));
    return () => {
      current = false;
    };
  }, [terminal]);
  useIdleReturn(signOut, { idleMs, active: signedIn !== undefined });
  // Every way out of a session ends it at the host, leaving the screen included. A reload runs no
  // cleanup, so the kept token still names an open session. Ending one that already ended returns
  // `ended: false`.
  useEffect(() => {
    if (!signedIn) return;
    keep(terminal, signedIn.token);
    const timer = setTimeout(signOut, Math.max(0, signedIn.session.expiresAt - Date.now()));
    return () => {
      clearTimeout(timer);
      keep(terminal, undefined);
      void post(stationPaths.signOut, { token: signedIn.token }).catch(() => undefined);
    };
  }, [signedIn, signOut, terminal]);

  return (
    <OperatorSurface density="touch" className="min-h-0 rounded-xl">
      {signedIn ? (
        <OperatorSessionProvider
          token={signedIn.token}
          session={signedIn.session}
          signOut={signOut}
          onRejected={signOut}
        >
          <OperatorHeader
            title={signedIn.session.principalId}
            context={`Signed in at ${terminal} until ${time(signedIn.session.expiresAt)}`}
            actions={
              <Button variant="outline" onClick={signOut}>
                <LogOut aria-hidden />
                Sign out
              </Button>
            }
          />
          <Work />
        </OperatorSessionProvider>
      ) : restoring ? (
        <OperatorHeader title={`Terminal ${terminal}`} context="Checking the session" />
      ) : (
        <>
          <OperatorHeader title={`Terminal ${terminal}`} context="Signed out" />
          <SignIn terminal={terminal} badgePattern={badgePattern} onSignedIn={setSignedIn} />
        </>
      )}
    </OperatorSurface>
  );
}
