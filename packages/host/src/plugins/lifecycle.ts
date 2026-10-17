import type { AnyApplicationDefinition } from '@agent-native/kernel/application';
import {
  openPlugins as openOnPlatform,
  type OpenPluginsOptions,
} from '@agent-native/kernel/plugins/lifecycle';
import { bunPlatform } from '../platform/bun';

export type { OpenedPlugins } from '@agent-native/kernel/plugins/lifecycle';

/** The kernel's `openPlugins` on the Bun platform. */
export function openPlugins(
  definition: AnyApplicationDefinition,
  options: Omit<OpenPluginsOptions, 'platform'>,
) {
  return openOnPlatform(definition, { ...options, platform: bunPlatform });
}
