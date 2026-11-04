import type { Catalog, CatalogOsAction, CatalogOsHandler } from '@tortoise/contracts';

/**
 * What other applications on the device can hand to this one (handlers: local ingress from an
 * unauthenticated sender) and what this one hands to them (actions: local outbound with the data
 * classes it carries). Platform registrations are generated from the same declarations.
 */
export interface OsManifest {
  readonly handlers: readonly {
    readonly id: string;
    readonly owner: string;
    readonly kind: CatalogOsHandler['kind'];
    /** What the OS registers: a link path, extensions, accepted share content, an intent action. */
    readonly registers: string;
    /** Where an accepted request goes: `open`, `screen`, `prepare` (a person confirms) or a consumer. */
    readonly target: string;
  }[];
  readonly actions: readonly {
    readonly id: string;
    readonly owner: string;
    readonly kind: CatalogOsAction['kind'];
    readonly reaches: string;
    readonly dataClasses: readonly string[];
  }[];
}

function registers(handler: CatalogOsHandler): string {
  switch (handler.kind) {
    case 'link':
      return `${handler.verified ? 'scheme and verified https' : 'scheme'} ${handler.path}`;
    case 'file':
      return handler.types.flatMap((type) => type.extensions.map((e) => `.${e}`)).join(' ');
    case 'share':
      return [
        handler.accepts.text ? 'text' : '',
        handler.accepts.url ? 'url' : '',
        ...(handler.accepts.mediaTypes ?? []),
      ]
        .filter(Boolean)
        .join(' ');
    case 'intent':
      return handler.action;
    case 'shortcut':
      return handler.title;
    case 'reply':
      return `replies for ${handler.consumer}`;
  }
}

function target(handler: CatalogOsHandler): string {
  if (handler.kind === 'reply') return `consumer ${handler.consumer}`;
  const value = handler.target;
  if ('open' in value) return `open ${value.open}`;
  if ('screen' in value) return `screen ${value.screen}`;
  if ('prepare' in value) return `prepare ${value.prepare}`;
  return `consumer ${value.consumer}`;
}

function reaches(action: CatalogOsAction): string {
  switch (action.kind) {
    case 'open':
      return action.url;
    case 'reveal':
    case 'open-file':
      return `files below setting ${action.root}`;
    case 'share':
      return 'the share sheet';
    case 'notify':
      return action.targets?.length
        ? `notifications for ${action.targets.join(', ')}`
        : 'notifications';
    case 'intent':
      return action.package ? `${action.action} in ${action.package}` : action.action;
  }
}

export function osManifest(catalog: Catalog): OsManifest {
  return {
    handlers: (catalog.os?.handlers ?? []).map((handler) => ({
      id: handler.id,
      owner: handler.owner,
      kind: handler.kind,
      registers: registers(handler),
      target: target(handler),
    })),
    actions: (catalog.os?.actions ?? []).map((action) => ({
      id: action.id,
      owner: action.owner,
      kind: action.kind,
      reaches: reaches(action),
      dataClasses: [...action.dataClasses].sort(),
    })),
  };
}

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The data-flow document's section for OS handlers and actions; empty when none are declared. */
export function osTables(os: OsManifest): string[] {
  if (!os.handlers.length && !os.actions.length) return [];
  return [
    '## OS handlers and actions',
    '',
    'Handlers accept requests from any application or web page on the device; an unsolicited request only opens a screen or prefills a form that a person confirms. Actions hand data to another application.',
    '',
    '| Handler | Owner | Kind | Registers | Target |',
    '| --- | --- | --- | --- | --- |',
    ...os.handlers.map(
      (item) =>
        `| \`${item.id}\` | ${item.owner} | ${item.kind} | ${cell(item.registers)} | ${cell(item.target)} |`,
    ),
    '',
    '| Action | Owner | Kind | Reaches | Data classes |',
    '| --- | --- | --- | --- | --- |',
    ...os.actions.map(
      (item) =>
        `| \`${item.id}\` | ${item.owner} | ${item.kind} | ${cell(item.reaches)} | ${cell(item.dataClasses.join(', '))} |`,
    ),
    '',
  ];
}
