/**
 * What an agent run asks the screen it was started from to show. An intent changes no records:
 * the screen accepts or rejects it, and the person acts through commands as usual.
 *
 * - `openResource`: open the screen that shows the resource, as `screens.resources` maps it.
 * - `selectResource`: select the resource on the current screen, without navigating.
 * - `requestReview`: ask the person to review, naming the operations involved and the resources
 *   to look at, such as the `approval-request:<id>` records the run created.
 */
export type UiIntent =
  | { readonly type: 'openResource' | 'selectResource'; readonly resource: string }
  | {
      readonly type: 'requestReview';
      readonly title: string;
      readonly operations: readonly string[];
      readonly resources?: readonly string[];
    };

/** The resource ID form a UI session accepts: `<kind>:<id>`. */
export const uiResourcePattern = /^[a-z][a-z0-9_-]*:[^\s:]{1,128}$/;
