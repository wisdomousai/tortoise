import type { AnyApplicationDefinition } from '@tortoise/kernel/application';
import {
  openPlugins as openOnPlatform,
  type OpenPluginsOptions,
} from '@tortoise/kernel/plugins/lifecycle';
import { bunPlatform } from '../platform/bun';

export type { OpenedPlugins } from '@tortoise/kernel/plugins/lifecycle';

/** The kernel's `openPlugins` on the Bun platform. */
export function openPlugins(
  definition: AnyApplicationDefinition,
  options: Omit<OpenPluginsOptions, 'platform'>,
) {
  return openOnPlatform(definition, { ...options, platform: bunPlatform });
}
