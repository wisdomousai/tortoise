import type { UiIntent } from '@agent-native/contracts';

/** A review an agent asked for, shown until the person acknowledges or dismisses it. */
export interface UiReview {
  readonly id: string;
  readonly title: string;
  readonly operations: readonly string[];
  /** Records to look at, such as approval requests; each opens through `screens.resources`. */
  readonly resources: readonly string[];
}

export interface UiIntentHandlers {
  /** Open the screen that shows the resource. */
  readonly open: (resource: string) => Promise<void>;
  /**
   * Make the resource the current screen's selection without navigating. Absent, or throwing for
   * a kind the screen does not show, rejects the intent.
   */
  readonly select?: (resource: string) => Promise<void>;
  readonly review: (review: UiReview) => void;
}

/**
 * Apply one intent. An open or a selection completes as accepted or rejected; a review completes
 * when the person acknowledges it, so it returns nothing here.
 */
export async function applyUiIntent(
  id: string,
  intent: UiIntent,
  handlers: UiIntentHandlers,
): Promise<'accepted' | 'rejected' | undefined> {
  if (intent.type === 'requestReview') {
    handlers.review({
      id,
      title: intent.title,
      operations: intent.operations,
      resources: intent.resources ?? [],
    });
    return undefined;
  }
  const apply = intent.type === 'openResource' ? handlers.open : handlers.select;
  if (!apply) return 'rejected';
  try {
    await apply(intent.resource);
    return 'accepted';
  } catch {
    return 'rejected';
  }
}
