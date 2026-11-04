import type { SystemOfRecordPort } from '@tortoise/integration';
import { fileDropPort, type FileDropOptions } from './drop';
import { folderInbound, type FolderInboundOptions } from './inbound';

/**
 * One system of record reached through folders: effects dropped as files, receipts or the
 * archive for their outcome, and an inbox of result exports for inbound sync. Either half may be
 * left out: a target that only reports needs no drop, one that only receives needs no inbox.
 */
export function fileTargetPort<Item>(options: {
  readonly target: string;
  readonly drop?: Omit<FileDropOptions, 'target' | 'folders'>;
  readonly inbound?: Omit<FolderInboundOptions<Item>, 'folders'>;
  readonly folders: FileDropOptions['folders'];
}): SystemOfRecordPort<Item> {
  const { target, folders } = options;
  const drop = options.drop ? fileDropPort({ ...options.drop, target, folders }) : undefined;
  const pull = options.inbound ? folderInbound<Item>({ ...options.inbound, folders }) : undefined;
  return {
    describe: () => ({ target, idempotentDelivery: false }),
    deliver: (effect, signal) => {
      if (!drop) throw new Error(`File target ${target} has no drop folder`);
      return drop.deliver(effect, signal);
    },
    ...(drop ? { lookup: drop.lookup!.bind(drop) } : {}),
    ...(pull ? { pull } : {}),
  };
}
