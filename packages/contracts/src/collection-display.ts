import type { DisplayField } from './display';

/** A UI binding, or the reason an operation has none. Defaults to binding the operation. */
export type UiDeclaration = { readonly binding?: string; readonly exception?: string };

/** The parts of a collection that generated operations present; internal to the generators. */
interface Presented {
  readonly type: string;
  readonly resourceType: string;
  readonly key: string;
  readonly titleField?: string;
  readonly fields?: readonly DisplayField[];
}

export const readPermission = (collection: Presented) => ({
  action: 'read',
  resourceType: collection.resourceType,
});

/** A generated operation's display: the collection's names, resource kind, key and fields. */
export const readDisplay = (collection: Presented, label: string) => ({
  label,
  resource: collection.type,
  key: collection.key,
  ...(collection.titleField ? { titleField: collection.titleField } : {}),
  ...(collection.fields ? { fields: collection.fields } : {}),
});
