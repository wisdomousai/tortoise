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

export interface SeatOptions {
  /** The seat's name, which the session and the audit log record. */
  readonly seat: string;
  /** What a signed-in operator works on. It reads the operator's client with `useOperatorSession`. */
  readonly work: ComponentType;
  /** Inactivity after which the seat signs the operator out; two minutes by default. */
  readonly idleMs?: number;
  /** The badge format, as a regular expression whose group 1, when present, is the badge value. */
  readonly badgePattern?: string;
}

interface SignedIn {
  readonly token: string;
  readonly session: OperatorSessionRecord;
}

/** POST to a station route with the seat's own session cookie. */
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
    throw new Error(payload?.error?.message ?? `The seat answered ${response.status}`);
  return payload as T;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { timeStyle: 'short' });

/** Badge, then PIN. The badge value stays in this component until the sign-in answers. */
function SignIn({
  seat,
  badgePattern,
  onSignedIn,
}: {
  seat: string;
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
    post<SignedIn>(stationPaths.signIn, { badge, pin: entry, seat })
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
 * A seat at a shared workstation. Signed out, it reads a badge from the scanner or by hand and a
 * PIN from the keypad, and signs in at the station route with the seat's own session. Signed in,
 * it shows `work` as the operator until sign-out, inactivity, the session's expiry or a rejected
 * credential returns it to sign-in.
 */
export function SeatScreen({
  seat,
  work: Work,
  idleMs = 120_000,
  badgePattern = '^(.{1,256})$',
}: SeatOptions) {
  const [signedIn, setSignedIn] = useState<SignedIn>();
  const signOut = useCallback(() => setSignedIn(undefined), []);
  useIdleReturn(signOut, { idleMs, active: signedIn !== undefined });
  // Every way out of a session ends it at the host, leaving the screen included, since the token
  // lives only here. Ending one that already ended answers `ended: false`.
  useEffect(() => {
    if (!signedIn) return;
    const timer = setTimeout(signOut, Math.max(0, signedIn.session.expiresAt - Date.now()));
    return () => {
      clearTimeout(timer);
      void post(stationPaths.signOut, { token: signedIn.token }).catch(() => undefined);
    };
  }, [signedIn, signOut]);

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
            context={`Signed in at ${seat} until ${time(signedIn.session.expiresAt)}`}
            actions={
              <Button variant="outline" onClick={signOut}>
                <LogOut aria-hidden />
                Sign out
              </Button>
            }
          />
          <Work />
        </OperatorSessionProvider>
      ) : (
        <>
          <OperatorHeader title={`Seat ${seat}`} context="Signed out" />
          <SignIn seat={seat} badgePattern={badgePattern} onSignedIn={setSignedIn} />
        </>
      )}
    </OperatorSurface>
  );
}
