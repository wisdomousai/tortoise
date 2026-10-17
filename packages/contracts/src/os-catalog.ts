import { mediaTypePattern } from './blob';
import type { CapabilityModule } from './capability';
import type { JsonObject } from './json';
import {
  osRequestFields,
  type OsAction,
  type OsDeclarations,
  type OsHandler,
  type OsTarget,
} from './os';
import { linkPathSegments, linkPathShape, templatePlaceholders } from './os-templates';
import type { Schema } from './schema';

/** A declaration as the catalog stores it: schemas become JSON Schema, and the owner is named. */
type Catalogued<T> = {
  readonly [K in keyof T]: T[K] extends Schema | undefined ? JsonObject : T[K];
} & { readonly owner: string };
export type CatalogOsHandler = OsHandler extends infer H
  ? H extends OsHandler
    ? Catalogued<H>
    : never
  : never;
export type CatalogOsAction = OsAction extends infer A
  ? A extends OsAction
    ? Catalogued<A>
    : never
  : never;
/** Every composed OS handler and action, sorted by ID. Omitted from a catalog when empty. */
export interface CatalogOs {
  readonly handlers: readonly CatalogOsHandler[];
  readonly actions: readonly CatalogOsAction[];
}

const idPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const settingPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const extensionPattern = /^[a-z0-9]{1,16}$/;
const androidActionPattern = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const androidPackagePattern = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const extraTypes = new Set(['string', 'number', 'integer', 'boolean']);
const shareMediaPattern =
  /^(?:[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}))$/;
const maxTextBytes = 1024 * 1024;
const maxBlobBytes = 256 * 1024 * 1024;
const openSchemes = new Set(['https:', 'mailto:', 'tel:']);

const properties = (schema: Schema | undefined): readonly string[] =>
  Object.keys((schema?.jsonSchema.properties as JsonObject | undefined) ?? {});

function checkTemplates(where: string, templates: readonly string[], names: readonly string[]) {
  for (const template of templates)
    for (const name of templatePlaceholders(template))
      if (!names.includes(name)) throw new Error(`${where} names unknown field {${name}}`);
}

/** A target's references: a command with a UI binding and only its own top-level fields. */
function checkTarget(
  where: string,
  target: OsTarget,
  names: readonly string[],
  commands: ReadonlyMap<string, CapabilityModule['capabilities'][number]>,
) {
  if ('open' in target) {
    if (!idPattern.test(target.open)) throw new Error(`${where} opens an invalid resource kind`);
    return checkTemplates(where, [target.id], names);
  }
  if ('screen' in target) {
    if (!target.screen) throw new Error(`${where} names no screen`);
    return checkTemplates(where, Object.values(target.search ?? {}), names);
  }
  if ('consumer' in target) {
    if (!idPattern.test(target.consumer)) throw new Error(`${where} names an invalid consumer`);
    return;
  }
  const command = commands.get(target.prepare);
  if (!command || command.kind !== 'command' || !command.ui?.binding)
    throw new Error(
      `${where} prepares ${target.prepare}, which is not a command with a UI binding`,
    );
  const fields = properties(command.input);
  for (const key of Object.keys(target.input))
    if (!fields.includes(key))
      throw new Error(`${where} prefills ${key}, which is not an input field of ${target.prepare}`);
  checkTemplates(where, Object.values(target.input), names);
}

/** Android extras cross the bridge as flat values: each property a string, number or boolean. */
function checkExtras(where: string, extras: Schema | undefined) {
  const declared = (extras?.jsonSchema.properties as Record<string, JsonObject> | undefined) ?? {};
  for (const [name, property] of Object.entries(declared))
    if (typeof property.type !== 'string' || !extraTypes.has(property.type))
      throw new Error(`${where} has extra ${name}, which is not a string, number or boolean`);
}

function checkMaxBytes(where: string, maxBytes: number, limit: number) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > limit)
    throw new Error(`${where} needs maxBytes between 1 and ${limit}`);
}

/** Per-kind rules; returns the field names the handler's templates may use. */
function handlerFields(where: string, handler: OsHandler, claimed: Set<string>): readonly string[] {
  const claim = (key: string) => {
    if (claimed.has(key)) throw new Error(`${where} claims ${key.split('\0').join(' ')} twice`);
    claimed.add(key);
  };
  const base = osRequestFields[handler.kind];
  switch (handler.kind) {
    case 'link': {
      const params = linkPathSegments(handler.path).flatMap((s) => ('param' in s ? [s.param] : []));
      const declared = properties(handler.params);
      for (const param of params)
        if (!declared.includes(param)) throw new Error(`${where} has no schema for :${param}`);
      claim(`link\0${linkPathShape(handler.path)}`);
      return [...declared, ...base];
    }
    case 'file':
      if (!handler.types.length) throw new Error(`${where} declares no file types`);
      checkMaxBytes(
        where,
        handler.maxBytes,
        handler.payload === 'text' ? maxTextBytes : maxBlobBytes,
      );
      for (const type of handler.types) {
        for (const extension of type.extensions) {
          if (!extensionPattern.test(extension))
            throw new Error(`${where} has extension ${extension}`);
          claim(`extension\0${extension}`);
        }
        for (const mediaType of type.mediaTypes) {
          if (!mediaTypePattern.test(mediaType))
            throw new Error(`${where} has media type ${mediaType}`);
          claim(`media type\0${mediaType}`);
        }
      }
      return base;
    case 'share':
      if (!handler.accepts.text && !handler.accepts.url && !handler.accepts.mediaTypes?.length)
        throw new Error(`${where} accepts nothing`);
      for (const mediaType of handler.accepts.mediaTypes ?? [])
        if (!shareMediaPattern.test(mediaType))
          throw new Error(`${where} has media type ${mediaType}`);
      checkMaxBytes(where, handler.maxBytes, maxBlobBytes);
      claim(`share\0${handler.id}`);
      return base;
    case 'intent':
      if (!androidActionPattern.test(handler.action))
        throw new Error(`${where} has action ${handler.action}`);
      checkExtras(where, handler.extras);
      claim(`intent action\0${handler.action}`);
      return [...properties(handler.extras), ...base];
    case 'shortcut':
      // Launchers write the title into a menu, a jump list and Android string resources.
      if (
        !handler.title ||
        handler.title.length > 64 ||
        /[\u0000-\u001f\u007f]/.test(handler.title)
      )
        throw new Error(`${where} needs a short one-line title`);
      return base;
    case 'reply':
      if (!idPattern.test(handler.consumer)) throw new Error(`${where} names an invalid consumer`);
      return base;
  }
}

/** The fixed part of an `open` URL: scheme, host and path segments, with no query or fragment. */
function checkOpenUrl(where: string, template: string, params: readonly string[]) {
  const names = templatePlaceholders(template);
  const probe = new URL(template.replace(/\{[^}]*\}/g, 'x'));
  if (!openSchemes.has(probe.protocol)) throw new Error(`${where} opens scheme ${probe.protocol}`);
  if (probe.username || probe.password || probe.search || probe.hash)
    throw new Error(`${where} must not carry credentials, a query or a fragment`);
  if (probe.protocol === 'https:') {
    const origin = `https://${probe.host}`;
    if (!probe.host || template.slice(0, origin.length).toLowerCase() !== origin.toLowerCase())
      throw new Error(`${where} must fix its host`);
  }
  for (const name of names)
    if (!params.includes(name)) throw new Error(`${where} names unknown parameter {${name}}`);
}

function checkAction(
  where: string,
  action: OsAction,
  replies: ReadonlySet<string>,
  commands: ReadonlyMap<string, CapabilityModule['capabilities'][number]>,
) {
  if (!action.dataClasses.length) throw new Error(`${where} declares no data classes`);
  switch (action.kind) {
    case 'open':
      return checkOpenUrl(where, action.url, properties(action.params));
    case 'reveal':
    case 'open-file':
      if (!settingPattern.test(action.root))
        throw new Error(`${where} has root setting ${action.root}`);
      return;
    case 'share':
      if (!action.accepts.text && !action.accepts.url && !action.accepts.mediaTypes?.length)
        throw new Error(`${where} shares nothing`);
      return;
    case 'notify':
      if (action.targets?.length && action.offline !== 'queue')
        throw new Error(`${where} carries outbox targets and must queue while offline`);
      for (const category of action.categories)
        for (const button of category.actions)
          if (!replies.has(button.reply))
            throw new Error(`${where} replies to undeclared reply handler ${button.reply}`);
      // The notifications plugin settles each delivered effect with the target's own command.
      for (const target of action.targets ?? [])
        if (commands.get(`${target}.effect.settle`)?.kind !== 'command')
          throw new Error(
            `${where} carries ${target}, which has no ${target}.effect.settle command`,
          );
      return;
    case 'intent':
      if (!androidActionPattern.test(action.action))
        throw new Error(`${where} has action ${action.action}`);
      if (!androidPackagePattern.test(action.package))
        throw new Error(`${where} must name the package it starts`);
      return checkExtras(where, action.extras);
  }
}

function catalogued(declaration: OsHandler | OsAction, owner: string) {
  const schemas = declaration as { readonly params?: Schema; readonly extras?: Schema };
  return {
    ...declaration,
    ...(schemas.params ? { params: schemas.params.jsonSchema } : {}),
    ...(schemas.extras ? { extras: schemas.extras.jsonSchema } : {}),
    owner,
  };
}
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Validate and merge the OS declarations of modules and host components. Throws on the first
 * violation, naming the owner and declaration. `prepare` targets are checked against the
 * composed modules' commands; resource kinds and screens are checked where they are known
 * (`defineApplication`, `defineScreens`), and consumers when the OS plugin opens.
 */
export function collectOs(
  owners: readonly { readonly id: string; readonly os?: OsDeclarations }[],
  modules: readonly CapabilityModule[],
): CatalogOs | undefined {
  const commands = new Map(modules.flatMap((m) => m.capabilities.map((c) => [c.id, c] as const)));
  const ids = { handlers: new Set<string>(), actions: new Set<string>() };
  const claimed = new Set<string>();
  const handlers: CatalogOsHandler[] = [];
  const actions: CatalogOsAction[] = [];
  const claimId = (kind: keyof typeof ids, id: string, where: string) => {
    if (!idPattern.test(id)) throw new Error(`Invalid ID for ${where}`);
    if (ids[kind].has(id)) throw new Error(`Duplicate OS ${kind.slice(0, -1)}: ${id}`);
    ids[kind].add(id);
  };
  for (const { id: owner, os } of owners)
    for (const handler of os?.handlers ?? []) {
      const where = `OS handler ${handler.id} (${owner})`;
      claimId('handlers', handler.id, where);
      if (!handler.description) throw new Error(`Missing description for ${where}`);
      const names = handlerFields(where, handler, claimed);
      if (handler.kind !== 'reply') checkTarget(where, handler.target, names, commands);
      handlers.push(catalogued(handler, owner) as unknown as CatalogOsHandler);
    }
  const replies = new Set(handlers.filter((h) => h.kind === 'reply').map((h) => h.id));
  for (const { id: owner, os } of owners)
    for (const action of os?.actions ?? []) {
      const where = `OS action ${action.id} (${owner})`;
      claimId('actions', action.id, where);
      if (!action.description) throw new Error(`Missing description for ${where}`);
      checkAction(where, action, replies, commands);
      actions.push(catalogued(action, owner) as unknown as CatalogOsAction);
    }
  if (!handlers.length && !actions.length) return undefined;
  return { handlers: handlers.sort(byId), actions: actions.sort(byId) };
}

/** Outbox targets carried by a queueing `notify` action instead of a network destination. */
export function osActionTargets(os: CatalogOs | undefined): ReadonlySet<string> {
  return new Set(
    (os?.actions ?? []).flatMap((action) =>
      action.kind === 'notify' ? (action.targets ?? []) : [],
    ),
  );
}
