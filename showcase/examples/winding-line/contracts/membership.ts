import { defineMembership } from '@tortoise/contracts';
import { stationRoleSchema } from './schemas';

/** Station roles: operators run the station, supervisors also configure it, viewers read. */
export const stationMembership = defineMembership({
  id: 'line.station',
  container: { field: 'station', type: 'station', resourceType: 'Station', label: 'Station' },
  roles: stationRoleSchema,
  manager: 'supervisor',
  description:
    'Grant or remove a station role (operator, supervisor, viewer) as supervisor of that station. A null role removes access. You cannot change your own role or give integration principals a role.',
  ui: { binding: 'line.station.bridge' },
});
