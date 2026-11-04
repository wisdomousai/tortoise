import { defineModule } from '@tortoise/contracts';
import { auditOperations } from './contracts/audit';
import { relayOperations } from './contracts/relay';
import { releaseOperations } from './contracts/releases';
import { siteOperations } from './contracts/sites';

/** Every operation people call on the fleet, by key. Browser-safe. */
export const operations = {
  ...siteOperations,
  ...releaseOperations,
  ...auditOperations,
  ...relayOperations,
} as const;

/** Sites, releases and channels, forwarded audit events and relay requests. */
export const fleetModule = defineModule({
  id: 'fleet',
  capabilities: Object.values(operations),
});
