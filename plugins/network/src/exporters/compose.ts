import type { ExportOptions } from '../exporters';
import type { RuleSet } from '../rules';
import { defaults, document, serviceArgs } from './common';

export function compose(rules: RuleSet, options: ExportOptions): string {
  const d = defaults(rules, options);
  return document(
    rules,
    'compose',
    {
      services: {
        [d.name]: {
          image: d.image,
          command: serviceArgs(d),
          user: `${d.uid}:${d.uid}`,
          read_only: true,
          cap_drop: ['ALL'],
          security_opt: ['no-new-privileges:true'],
          tmpfs: ['/tmp:size=64m'],
          volumes: [
            `${d.name}-workspace:${d.workspace}`,
            `${d.name}-audit:${d.auditLog}`,
            `./deployment-policy.json:${d.deploymentPolicy}:ro`,
          ],
          networks: [`${d.name}-egress`],
        },
      },
      networks: {
        [`${d.name}-egress`]: { driver: 'bridge' },
      },
      volumes: { [`${d.name}-workspace`]: {}, [`${d.name}-audit`]: {} },
    },
    [
      'NOT ENFORCED: Compose cannot filter egress by destination. Apply the nftables export on the',
      'host (or k8s-networkpolicy in a cluster); this file only hardens the container.',
    ],
  );
}
