import { z } from 'zod';
import { defineCapability, type AnyCapability } from './capability';
import { recordKeySchema } from './collection';
import { jsonSchema } from './schema';

export interface MembershipSpec<
  Id extends string,
  Field extends string,
  Roles extends z.ZodEnum<Record<string, string>>,
> {
  /** Operation prefix; yields `<id>.set-member`, for example `inspection.plant.set-member`. */
  readonly id: Id;
  /** The containers people hold roles in. */
  readonly container: {
    /** Input and output field naming the container, for example `plant`. */
    readonly field: Field;
    /** Journal resource type of a container; a role change is the event `<type>:<id>`. */
    readonly type: string;
    /** Permission subject of `set-member`, for example `Plant`. */
    readonly resourceType: string;
    readonly label: string;
  };
  readonly roles: Roles;
  /** The role that may grant and remove roles in its container. */
  readonly manager: z.output<Roles>;
  readonly description: string;
  readonly ui?: { readonly binding?: string; readonly exception?: string };
}

export type SetMemberInput<Field extends string, Role> = { readonly [F in Field]: string } & {
  readonly principalId: string;
  /** `null` removes the caller's role in the container. */
  readonly role: Role | null;
};
export type SetMemberOutput<Field extends string, Role> = { readonly [F in Field]: string } & {
  readonly members: Record<string, Role>;
};

/**
 * Declare roles scoped to a container: who may do what in which project, plant or station. The
 * result is one catalog command, `<id>.set-member`, that grants, changes or removes a role, plus
 * the declaration the server pairs with `membershipHandler` and the policy builder's
 * `membershipRule`. Browser-safe.
 */
export function defineMembership<
  const Id extends string,
  const Field extends string,
  Roles extends z.ZodEnum<Record<string, string>>,
>(spec: MembershipSpec<Id, Field, Roles>) {
  if (!spec.roles.options.includes(spec.manager))
    throw new Error(`Membership manager is not a role: ${spec.manager}`);
  type Role = z.output<Roles>;
  const field = spec.container.field;
  const setMember = defineCapability({
    id: `${spec.id}.set-member` as `${Id}.set-member`,
    kind: 'command',
    description: spec.description,
    input: jsonSchema(
      z.strictObject({
        [field]: recordKeySchema,
        principalId: recordKeySchema,
        role: spec.roles.nullable(),
      }) as unknown as z.ZodType<SetMemberInput<Field, Role>>,
    ),
    output: jsonSchema(
      z.strictObject({
        [field]: recordKeySchema,
        members: z.record(z.string(), spec.roles),
      }) as unknown as z.ZodType<SetMemberOutput<Field, Role>>,
    ),
    permission: { action: 'administer', resourceType: spec.container.resourceType },
    dependencies: [spec.container.type],
    ui: spec.ui ?? { binding: `${spec.id}.set-member` },
  });
  return Object.freeze({
    id: spec.id,
    container: spec.container,
    roles: spec.roles.options as unknown as readonly Role[],
    manager: spec.manager as Role,
    setMember,
  });
}
/** Any declared membership, as the server-side helpers accept it. */
export interface Membership {
  readonly id: string;
  readonly container: MembershipSpec<
    string,
    string,
    z.ZodEnum<Record<string, string>>
  >['container'];
  readonly roles: readonly string[];
  readonly manager: string;
  readonly setMember: AnyCapability;
}
