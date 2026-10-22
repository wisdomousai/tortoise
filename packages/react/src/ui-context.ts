export type { UiIntent } from '@agent-native/contracts';
export interface UiContext {
  sessionId: string;
  selectedResources: readonly string[];
  observedRevisions: Readonly<Record<string, number>>;
}
/** UI context is an explicit immutable target snapshot, never ambient instance. */
export function captureUiContext(context: UiContext): UiContext {
  return structuredClone(context);
}
