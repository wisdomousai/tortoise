import { PENDING_EXIT_CODE, takeFlag } from '@agent-native/adapters/cli';
import type { AnyApplicationDefinition } from '../application';
import { openEmbeddedAuthority, type EmbeddedAuthority } from '../embedded';
import type { PluginSettings } from '../plugins/settings';
import { finite, rejectRemaining, report, settingsOf, workspaceOf } from './args';

async function withEmbedded<T>(
  definition: AnyApplicationDefinition,
  workspacePath: string,
  settings: PluginSettings,
  use: (authority: EmbeddedAuthority) => Promise<T>,
): Promise<T> {
  const authority = await openEmbeddedAuthority(definition, { workspacePath, settings });
  try {
    return await use(authority);
  } finally {
    await authority.close();
  }
}

/** `drain`: deliver pending effects once; exits with PENDING_EXIT_CODE while any remain. */
export async function drainCommand(definition: AnyApplicationDefinition, args: string[]) {
  const workspacePath = workspaceOf(args);
  const settings = settingsOf(definition.manifest, args);
  const timeout = finite(takeFlag(args, 'timeout'), 30_000, 'timeout');
  rejectRemaining(args);
  return withEmbedded(definition, workspacePath, settings, async ({ integrations }) => {
    // Pending counts every target in the outbox, including ones this process cannot deliver.
    const backlog = await integrations.drain(timeout);
    report(backlog);
    return backlog.pending ? PENDING_EXIT_CODE : 0;
  });
}

/** `sync`: pull master data from the system of record once. */
export async function syncCommand(definition: AnyApplicationDefinition, args: string[]) {
  const workspacePath = workspaceOf(args);
  const settings = settingsOf(definition.manifest, args);
  rejectRemaining(args);
  return withEmbedded(definition, workspacePath, settings, async ({ integrations }) => {
    report(await integrations.sync());
    return 0;
  });
}
