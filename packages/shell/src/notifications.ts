import type { OsInstruction, OsNotificationButton, RawOsRequest } from '@tortoise/contracts';

type NotifyInstruction = Extract<OsInstruction, { kind: 'notify' }>;

/** A notification as a platform shows it: the instruction without the action id. */
export interface ShellNotification {
  /** Stable per effect: showing the same id again replaces the earlier notification. */
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly body?: string;
  readonly buttons: readonly OsNotificationButton[];
}

export function shellNotification(instruction: NotifyInstruction): ShellNotification {
  return {
    id: instruction.id,
    category: instruction.category,
    title: instruction.title,
    ...(instruction.body !== undefined ? { body: instruction.body } : {}),
    buttons: instruction.buttons ?? [],
  };
}

const identifier = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The reply a chosen button submits, or `undefined` when the button is not one of `buttons`.
 * `buttons` may come back from the platform's notification data, so it is checked as unknown
 * input; the instance checks the nonce itself either way.
 */
export function replyRequest(buttons: unknown, chosen: string): RawOsRequest | undefined {
  if (!Array.isArray(buttons)) return undefined;
  const button = buttons.find(
    (item): item is OsNotificationButton =>
      typeof item === 'object' && item !== null && (item as { id?: unknown }).id === chosen,
  );
  if (
    !button ||
    ![button.id, button.handler, button.nonce].every(
      (value) => typeof value === 'string' && identifier.test(value),
    )
  )
    return undefined;
  return { kind: 'reply', handler: button.handler, nonce: button.nonce, action: button.id };
}
