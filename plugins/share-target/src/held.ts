/** What a web share target POST carried, held until the launch page session claims it. */
export interface HeldShare {
  readonly title?: string;
  readonly text?: string;
  readonly url?: string;
  readonly file?: { readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array };
}

/** Shares held at once; the oldest is dropped beyond this. */
const heldLimit = 8;
/** How long a code stays claimable. The redirect completes within a second when nothing is wrong. */
const heldMs = 120_000;

/** 128 random bits as base64url, so a code cannot be guessed by another page. */
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/**
 * Shares held under one-use codes. Nothing is persisted: a share not claimed within two minutes,
 * or before the host restarts, is gone, and at most eight wait at once, so posts nobody claims
 * cannot pile up.
 */
export function createHeldShares(now: () => number = Date.now) {
  const held = new Map<string, { share: HeldShare; until: number }>();
  const sweep = () => {
    for (const [code, entry] of held) if (entry.until <= now()) held.delete(code);
  };
  return {
    hold(share: HeldShare): string {
      sweep();
      const code = newCode();
      held.set(code, { share, until: now() + heldMs });
      while (held.size > heldLimit) held.delete(held.keys().next().value!);
      return code;
    },
    /** The share a code stands for, once; `undefined` when unknown, used or expired. */
    take(code: string): HeldShare | undefined {
      sweep();
      const entry = held.get(code);
      held.delete(code);
      return entry?.share;
    },
  };
}
export type HeldShares = ReturnType<typeof createHeldShares>;
