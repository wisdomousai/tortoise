import type { Schema } from './schema';

/**
 * OS handlers and OS actions: what an application registers with the operating system to
 * receive, and what it may ask the operating system to do. Both are browser-safe data. Generators
 * turn handlers into platform registrations (URL schemes, document types, intent filters, the web
 * manifest) and both into the security manifest; nothing registers itself at runtime.
 *
 * Trust boundary: a request the OS delivers comes from an unauthenticated sender (any web page,
 * app or file on the device). A handler's target can therefore only open a screen, open a
 * resource the person may read, or prefill a command form a person confirms. Only a `reply`,
 * matched by a plugin against a nonce the application issued, continues a command.
 */

/**
 * Where an accepted request goes. Strings are templates: `{name}` takes a link parameter, an
 * intent extra or a request field (`text`, `url`, `title`, `blob`, `file.name`, `file.stem`,
 * `file.mediaType`, `file.text`, `file.blob`, `data`).
 */
export type OsTarget =
  /** A selectable resource of this kind, e.g. `{ open: 'task', id: '{taskId}' }`. */
  | { readonly open: string; readonly id: string }
  /** A screen route path, with optional search parameters. */
  | { readonly screen: string; readonly search?: Readonly<Record<string, string>> }
  /** A command's form, prefilled; a person completes and confirms it. */
  | { readonly prepare: string; readonly input: Readonly<Record<string, string>> }
  /** A composed plugin that registered a receiver for this handler, such as a scanner source. */
  | { readonly consumer: string };

interface OsHandlerBase {
  readonly id: string;
  readonly description: string;
}
/** `<scheme>://<path>`; with `verified`, also `https://<site link host><path>` (App/Universal Links). */
export interface OsLinkHandler extends OsHandlerBase {
  readonly kind: 'link';
  /** Absolute path; `:name` segments are parameters, e.g. `/tasks/:taskId`. */
  readonly path: string;
  /** Strict object of the path parameters plus optional query parameters. */
  readonly params?: Schema;
  readonly verified?: boolean;
  readonly target: OsTarget;
}
export interface OsFileType {
  /** Lower-case extensions without a dot. */
  readonly extensions: readonly string[];
  readonly mediaTypes: readonly string[];
  /** Apple uniform type identifier, when the platform needs one. */
  readonly uti?: string;
  readonly description: string;
}
/** Files opened with the application (open-with, double-click, Android VIEW, web file handlers). */
export interface OsFileHandler extends OsHandlerBase {
  readonly kind: 'file';
  readonly types: readonly OsFileType[];
  readonly role: 'viewer' | 'editor';
  /** `text`: strict UTF-8 passed inline; `blob`: staged in the blob store as `file.blob`. */
  readonly payload: 'text' | 'blob';
  readonly maxBytes: number;
  readonly target: OsTarget;
}
/** Content shared to the application from another app's share sheet. */
export interface OsShareHandler extends OsHandlerBase {
  readonly kind: 'share';
  readonly accepts: {
    readonly text?: boolean;
    readonly url?: boolean;
    readonly mediaTypes?: readonly string[];
  };
  readonly maxBytes: number;
  readonly target: OsTarget;
}
/** An Android activity intent beyond VIEW and SEND. */
export interface OsIntentHandler extends OsHandlerBase {
  readonly kind: 'intent';
  readonly action: string;
  readonly categories?: readonly string[];
  readonly data?: { readonly scheme?: string; readonly mimeType?: string };
  /** Strict object of the string, number and boolean extras the intent may carry. */
  readonly extras?: Schema;
  readonly target: OsTarget;
}
/** A launcher entry: dock menu, jump list, desktop action, app shortcut, quick action. */
export interface OsShortcutHandler extends OsHandlerBase {
  readonly kind: 'shortcut';
  readonly title: string;
  readonly target: OsTarget;
}
/**
 * The reply to something the application issued, such as a notification action. The consumer
 * plugin matches its nonce; nothing else may accept it.
 */
export interface OsReplyHandler extends OsHandlerBase {
  readonly kind: 'reply';
  readonly consumer: string;
}
export type OsHandler =
  | OsLinkHandler
  | OsFileHandler
  | OsShareHandler
  | OsIntentHandler
  | OsShortcutHandler
  | OsReplyHandler;
export type OsHandlerKind = OsHandler['kind'];

interface OsActionBase {
  readonly id: string;
  readonly description: string;
  /** What leaves the application through this action, for the data-flow inventory. */
  readonly dataClasses: readonly string[];
}
/**
 * Open a URL in the default application. `url` fixes scheme, host and path; `{name}` path
 * segments come from `params`, and the remaining parameters form the query. A URL is accepted
 * only when it matches exactly this shape.
 */
export interface OsOpenAction extends OsActionBase {
  readonly kind: 'open';
  readonly url: string;
  readonly params?: Schema;
}
/** Show or open a file below the directory a plugin path setting names. */
export interface OsFileAction extends OsActionBase {
  readonly kind: 'reveal' | 'open-file';
  /** The plugin setting key whose path is the root; nothing outside it is reachable. */
  readonly root: string;
}
export interface OsShareAction extends OsActionBase {
  readonly kind: 'share';
  readonly accepts: OsShareHandler['accepts'];
}
export interface OsNotifyAction extends OsActionBase {
  readonly kind: 'notify';
  readonly categories: readonly {
    readonly id: string;
    readonly actions: readonly {
      readonly id: string;
      readonly title: string;
      /** The `reply` handler that receives this action. */
      readonly reply: string;
      readonly requiresUnlock?: boolean;
    }[];
  }[];
  /** Outbox targets this action carries; delivery then needs `offline: 'queue'`. */
  readonly targets?: readonly string[];
  readonly offline: 'queue' | 'drop';
}
/**
 * An explicit Android activity intent: the action and extras go only to the named package, so
 * no other app that declares the same action can receive them.
 */
export interface OsIntentAction extends OsActionBase {
  readonly kind: 'intent';
  readonly action: string;
  readonly package: string;
  /** Strict object of string, number and boolean extras the caller supplies. */
  readonly extras?: Schema;
}
export type OsAction =
  OsOpenAction | OsFileAction | OsShareAction | OsNotifyAction | OsIntentAction;
export type OsActionKind = OsAction['kind'];

/** What a module or host component declares. */
export interface OsDeclarations {
  readonly handlers?: readonly OsHandler[];
  readonly actions?: readonly OsAction[];
}

/** Request fields a template may name, by handler kind, besides parameters and extras. */
export const osRequestFields: Readonly<Record<OsHandlerKind, readonly string[]>> = {
  link: [],
  file: ['file.name', 'file.stem', 'file.mediaType', 'file.text', 'file.blob'],
  share: ['text', 'url', 'title', 'blob'],
  intent: ['data'],
  shortcut: [],
  reply: [],
};
