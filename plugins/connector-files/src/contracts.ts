import { defineHostComponent, type Availability } from '@tortoise/contracts';

/** The folders one file exchange uses; each is a folder ID the deployment policy binds. */
export interface FileExchangeFolders {
  /** Where effects are written as files for the other system to pick up. */
  readonly drop?: string;
  /** Where the other system writes one receipt per picked-up file, named after the effect. */
  readonly receipts?: string;
  /** Where the other system moves a file once it accepted it. */
  readonly archive?: string;
  /** Where the other system drops result exports that inbound sync reads. */
  readonly inbox?: string;
}

/**
 * Declare the folders of one file exchange as a host component, for an application manifest's
 * `components`. Browser-safe data. The drop folder carries `target`'s outbox effects, so the
 * catalog accepts the target without a network destination; the other folders are read-only.
 */
export function fileExchange(options: {
  readonly id: string;
  readonly target: string;
  readonly description: string;
  readonly folders: FileExchangeFolders;
  /** What the files carry, for the data-flow inventory. */
  readonly dataClasses: readonly string[];
  readonly availability?: Availability;
}) {
  const { folders, target, dataClasses } = options;
  const availability = options.availability ?? 'optional';
  const read = (id: string, purpose: string) => ({
    id,
    purpose,
    access: 'read' as const,
    dataClasses,
    availability,
  });
  return defineHostComponent({
    id: options.id,
    description: options.description,
    requirements: {
      folders: [
        ...(folders.drop
          ? [
              {
                id: folders.drop,
                purpose: `Files for ${target} to pick up, one per effect.`,
                access: 'write' as const,
                targets: [target],
                dataClasses,
                availability,
              },
            ]
          : []),
        ...(folders.receipts
          ? [read(folders.receipts, `Receipts ${target} writes for the files it picked up.`)]
          : []),
        ...(folders.archive
          ? [read(folders.archive, `Files ${target} accepted and moved aside.`)]
          : []),
        ...(folders.inbox ? [read(folders.inbox, `Result exports ${target} drops.`)] : []),
      ],
    },
  });
}
