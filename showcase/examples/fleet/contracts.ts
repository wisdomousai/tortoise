import { defineModule } from '@tortoise/contracts';
import { auditOperations } from './contracts/audit';
import { relayOperations } from './contracts/relay';
import { releaseOperations } from './contracts/releases';
import { instanceOperations } from './contracts/instances';

/** Every operation people call on the fleet, by key. Browser-safe. */
export const operations = {
  ...instanceOperations,
  ...releaseOperations,
  ...auditOperations,
  ...relayOperations,
} as const;

/** Instances, releases and channels, forwarded audit events and relay requests. */
export const fleetModule = defineModule({
  id: 'fleet',
  capabilities: Object.values(operations),
});
