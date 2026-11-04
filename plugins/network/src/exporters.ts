import type { RuleSet } from './rules';
import { compose } from './exporters/compose';
import { networkPolicy, pod } from './exporters/kubernetes';
import { nftables } from './exporters/nftables';
import { systemd } from './exporters/systemd';
import { windowsFirewall } from './exporters/windows-firewall';

export const exportFormats = [
  'json',
  'nftables',
  'windows-firewall',
  'k8s-networkpolicy',
  'k8s-pod',
  'compose',
  'systemd',
] as const;
export type ExportFormat = (typeof exportFormats)[number];

/** Deployment facts the rule set does not know. Defaults suit a Linux service install. */
export interface ExportOptions {
  /** OS account the service runs as; nftables matches it, systemd and containers run as it. */
  readonly user?: string;
  readonly uid?: number;
  /** Service executable, for program-scoped Windows rules and the systemd unit. */
  readonly executable?: string;
  readonly workspace?: string;
  readonly auditLog?: string;
  /** Deployment policy path the service is started with. */
  readonly deploymentPolicy?: string;
  /** Container image for the Kubernetes and compose manifests. */
  readonly image?: string;
}

/**
 * Render a rule set for one enforcement point. Every output is deterministic text, carries the
 * policy digest, and lists any bound destination it could not enforce by address. These are
 * exported artifacts: applying them is the operator's step, and nothing here touches the host.
 */
export function exportRules(
  rules: RuleSet,
  format: ExportFormat,
  options: ExportOptions = {},
): string {
  switch (format) {
    case 'json':
      return `${JSON.stringify(rules, null, 2)}\n`;
    case 'nftables':
      return nftables(rules, options);
    case 'windows-firewall':
      return windowsFirewall(rules, options);
    case 'k8s-networkpolicy':
      return networkPolicy(rules, options);
    case 'k8s-pod':
      return pod(rules, options);
    case 'compose':
      return compose(rules, options);
    case 'systemd':
      return systemd(rules, options);
  }
}
