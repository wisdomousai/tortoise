import type { BlobRef } from './blob';
import type { JsonObject, JsonValue } from './json';
import type { OsHandlerKind } from './os';

/**
 * Values that cross between a shell adapter, the host's shell routes, the shell port and the
 * frame. Browser-safe data. A raw request is untrusted: an adapter has checked only its syntax
 * and size, and the shell port decides everything else.
 */

/** Where a request came from or an action runs. */
export type OsPlatform = 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'web';
export const osPlatforms: readonly OsPlatform[] = [
  'macos',
  'windows',
  'linux',
  'android',
  'ios',
  'web',
];

/**
 * What the OS delivered, before any handler is chosen. `source` is what the platform says about
 * the sender (an app or package name), shown to the person and never trusted.
 */
export type RawOsRequest =
  | { readonly kind: 'url'; readonly url: string; readonly source?: string }
  | {
      readonly kind: 'file';
      readonly name: string;
      readonly mediaType?: string;
      /** UTF-8 content for a `text` payload. */
      readonly text?: string;
      /** A staged blob for a `blob` payload. */
      readonly blob?: BlobRef;
      readonly source?: string;
    }
  | {
      readonly kind: 'share';
      readonly text?: string;
      readonly url?: string;
      readonly title?: string;
      readonly mediaType?: string;
      readonly blob?: BlobRef;
      readonly source?: string;
    }
  | {
      readonly kind: 'intent';
      readonly action: string;
      readonly categories?: readonly string[];
      readonly data?: string;
      readonly mimeType?: string;
      readonly extras?: JsonObject;
      readonly source?: string;
    }
  | { readonly kind: 'shortcut'; readonly id: string }
  | {
      readonly kind: 'reply';
      /** The reply handler the issued notification named for this action. */
      readonly handler: string;
      readonly nonce: string;
      readonly action: string;
      readonly text?: string;
    };
export type RawOsRequestKind = RawOsRequest['kind'];

/** Shown above what a request opened or prefilled. Text only; never markup. */
export interface OsProvenance {
  readonly kind: OsHandlerKind;
  readonly handler: string;
  /** A file name, a host name or the sender's name, at most 200 characters. */
  readonly label?: string;
}

/**
 * What the frame is asked to show for an accepted request. `prepare` input holds only the fields
 * the handler's target maps; the person completes and submits the form through its binding.
 */
export type OsDelivery =
  | { readonly type: 'openResource'; readonly resource: string; readonly provenance: OsProvenance }
  | {
      readonly type: 'navigate';
      readonly to: string;
      readonly search?: Readonly<Record<string, string>>;
      readonly provenance: OsProvenance;
    }
  | {
      readonly type: 'prepare';
      readonly operation: string;
      readonly input: JsonObject;
      readonly provenance: OsProvenance;
    };

/** Stable reasons a request or action was refused; the event log records the same code. */
export type OsRefusal =
  | 'no-handler'
  | 'invalid'
  | 'disabled'
  | 'unsupported'
  | 'too-large'
  | 'rate-limited'
  | 'unattached'
  | 'failed';

export type OsRequestOutcome =
  /** Queued for the session that submitted it; `delivery` is what the frame will show. */
  | { readonly status: 'delivered'; readonly handler: string; readonly delivery: OsDelivery }
  /** Handed to the plugin that consumes the handler. */
  | { readonly status: 'consumed'; readonly handler: string }
  | { readonly status: 'refused'; readonly reason: OsRefusal; readonly handler?: string };

/** A request to perform a declared action. Params are validated against the declaration. */
export interface OsActionRequest {
  readonly action: string;
  readonly params?: JsonObject;
}

/** What a shell adapter executes. Built by the shell port from the declaration, never from a caller's string. */
export type OsInstruction =
  | { readonly kind: 'open'; readonly action: string; readonly url: string }
  | { readonly kind: 'reveal' | 'open-file'; readonly action: string; readonly path: string }
  | {
      readonly kind: 'share';
      readonly action: string;
      readonly text?: string;
      readonly url?: string;
      readonly title?: string;
    }
  | {
      readonly kind: 'notify';
      readonly action: string;
      /** Stable per effect, so a repeated delivery replaces rather than duplicates. */
      readonly id: string;
      readonly category: string;
      readonly title: string;
      readonly body?: string;
      /** Per notification action: the single-use nonce its reply carries. */
      readonly replies?: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: 'intent';
      readonly action: string;
      readonly intent: string;
      readonly package?: string;
      readonly extras?: JsonObject;
    };

export type OsActionOutcome =
  /** An attached adapter ran it. */
  | { readonly status: 'performed'; readonly action: string }
  /** The caller runs it itself, as a web page must while it has user activation. */
  | { readonly status: 'instruction'; readonly instruction: OsInstruction }
  | { readonly status: 'refused'; readonly reason: OsRefusal; readonly action?: string };

/** An adapter's answer to an instruction it was relayed. */
export interface OsActionResult {
  readonly ok: boolean;
  readonly detail?: JsonValue;
}
