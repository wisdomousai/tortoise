import { defineMembership } from '@tortoise/contracts';
import { plantRoleSchema } from './schemas';

/** Plant roles: inspectors record, supervisors decide and manage roles, viewers read. */
export const plantMembership = defineMembership({
  id: 'inspection.plant',
  container: { field: 'plant', type: 'plant', resourceType: 'Plant', label: 'Plant' },
  roles: plantRoleSchema,
  manager: 'supervisor',
  description:
    'Grant or remove a plant role as supervisor of that plant. A null role removes access. You cannot change your own role. Permission changes invalidate affected views.',
});
