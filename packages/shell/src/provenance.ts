import type { OsProvenance } from '@tortoise/contracts';

/**
 * Where an OS request came from, as a person reads it: "Opened from a file: notes.txt". The web
 * and native frames show the same words. Labels come from the sender; render them only as text.
 */
export function describeProvenance(provenance: OsProvenance): string {
  const what = {
    link: 'Opened from a link',
    file: 'Opened from a file',
    share: 'Shared from another app',
    intent: 'Opened by another app',
    shortcut: 'Opened from a shortcut',
    reply: 'Opened from a notification',
  }[provenance.kind];
  return provenance.label ? `${what}: ${provenance.label}` : what;
}
