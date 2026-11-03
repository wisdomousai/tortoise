import type { JsonObject, UiIntent } from '@agent-native/contracts';

/** A review an agent asked for, shown until the person acknowledges or dismisses it. */
export interface UiReview {
  readonly id: string;
  readonly title: string;
  readonly operations: readonly string[];
  /** Records to look at, such as approval requests; each opens through `screens.resources`. */
  readonly resources: readonly string[];
  /** The agent run that asked for the review, so the screen can name it. */
  readonly runId?: string;
}

/** One selected resource, as `<kind>:<id>`, and the revision the screen shows for it. */
export interface UiResource {
  readonly id: string;
  readonly revision: number;
}

/** The context a UI session registers for the resources a screen has selected. */
export function uiSelection(resources: readonly UiResource[]) {
  return {
    selectedResources: resources.map((resource) => resource.id),
    observedRevisions: Object.fromEntries(
      resources.map((resource) => [resource.id, resource.revision]),
    ),
  };
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
  /** Fill the command's form for the person to check and submit; throw to reject. */
  readonly prepare?: (operation: string, input: JsonObject, id: string) => Promise<void>;
}

/**
 * Apply one intent. An open, a selection or a prepared form completes as accepted or rejected; a
 * review completes when the person acknowledges it, so it returns nothing here. `runId` is the
 * run that sent the intent, when a run sent it.
 */
export async function applyUiIntent(
  id: string,
  intent: UiIntent,
  handlers: UiIntentHandlers,
  runId?: string,
): Promise<'accepted' | 'rejected' | undefined> {
  if (intent.type === 'requestReview') {
    handlers.review({
      id,
      title: intent.title,
      operations: intent.operations,
      resources: intent.resources ?? [],
      ...(runId ? { runId } : {}),
    });
    return undefined;
  }
  if (intent.type === 'prepare') {
    if (!handlers.prepare) return 'rejected';
    try {
      await handlers.prepare(intent.operation, intent.input, id);
      return 'accepted';
    } catch {
      return 'rejected';
    }
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
