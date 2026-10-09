/**
 * The network host plugin. `networkPluginManifest` is browser-safe (`./plugin-manifest`);
 * everything else is server only.
 *
 * - `networkPlugin`: the egress guard, child proxy and mTLS ingress as kernel ports.
 * - `networkRules`, `exportRules`: default-deny OS and orchestrator rules from a resolved policy.
 */
export { networkPlugin } from './plugin';
export { networkPluginManifest } from './plugin-manifest';
export { openNetwork, networkServiceOf, type NetworkService } from './open';
export { mtlsIngress } from './ingress';
export {
  networkRules,
  type AllowRule,
  type RuleOptions,
  type RuleSet,
  type UnresolvedRule,
} from './rules';
export { exportFormats, exportRules, type ExportFormat, type ExportOptions } from './exporters';
export { networkCliCommand, networkCommand, networkUsage } from './cli';
