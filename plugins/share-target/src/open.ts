import type { RawOsRequest } from '@agent-native/contracts';
import type { HostedApplication } from '@agent-native/kernel/application';
import type { PluginInstance, PluginOpenContext } from '@agent-native/kernel/plugin';
import type { ExecutionContext } from '@agent-native/runtime';
import { osServiceOf } from '@agent-native/os';
import { createHeldShares, type HeldShare } from './held';
import { shareTargetRoute } from './route';

/**
 * The request a held share stands for, as the session that claimed it: a file is staged in the
 * blob store under that session, so only it can attach the file, and only through a command
 * whose blob limits accept it.
 */
async function claimed(
  application: HostedApplication,
  context: ExecutionContext,
  share: HeldShare,
): Promise<RawOsRequest> {
  const title = share.title ?? share.file?.name;
  if (share.file) {
    const blob = await application.putBlob(share.file.bytes, share.file.mediaType, context);
    return {
      kind: 'share',
      mediaType: share.file.mediaType,
      blob,
      ...(title ? { title: title.slice(0, 200) } : {}),
    };
  }
  return {
    kind: 'share',
    ...(share.text ? { text: share.text } : {}),
    ...(share.url ? { url: share.url } : {}),
    ...(title ? { title: title.slice(0, 200) } : {}),
  };
}

/**
 * Open the share target plugin: enable share handlers and share actions in the OS plugin, and
 * on a serving host answer the web share target's POST and resolve the codes it issues. On a
 * device the mobile shell submits shares itself, so nothing is held there.
 */
export function openShareTarget(options: { now?: () => number } = {}) {
  return async (context: PluginOpenContext): Promise<PluginInstance> => {
    const os = osServiceOf(context.services);
    os.enable({ handlers: ['share'], actions: ['share'] });
    const held = createHeldShares(options.now);
    let application: HostedApplication | undefined;
    os.hold(async (caller, code) => {
      if (!application) return undefined;
      const share = held.take(code);
      return share && claimed(application, caller, share);
    });
    return {
      ready: async (hosted) => {
        application = hosted;
      },
      ...(context.serving
        ? {
            publicRoute: (request: Request) =>
              shareTargetRoute(request, () => context.catalog.os, held),
          }
        : {}),
    };
  };
}
