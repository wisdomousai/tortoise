import type { Page } from '@playwright/test';

/**
 * A recognizer in place of the browser's, installed before the page loads: `available` answers
 * `status`, and the test plays results through `window.dictation.hear`. Each recognizer records
 * how it was configured. Without `status` the browser has no speech recognition at all.
 *
 * Every parts-desk spec installs one without `status` before each test, since the composer asks
 * for on-device recognition on every screen and Playwright's default Chromium headless shell
 * crashes the page on `SpeechRecognition.available`. Full Chromium and Chrome answer it.
 */
export function stubRecognizer(page: Page, status?: string) {
  return page.addInitScript((status) => {
    const scope = window as unknown as Record<string, unknown>;
    delete scope.SpeechRecognition;
    delete scope.webkitSpeechRecognition;
    if (!status) return;
    type Results = { results: { transcript: string }[][] };
    const dictation = {
      checked: [] as unknown[],
      started: [] as Record<string, unknown>[],
      aborted: 0,
      current: undefined as undefined | FakeRecognition,
      /** Play the transcripts heard so far, the last one interim. */
      hear: (transcripts: string[]) =>
        dictation.current?.onresult?.({
          results: transcripts.map((transcript) => [{ transcript }]),
        }),
    };
    class FakeRecognition {
      static available = async (options: unknown) => (dictation.checked.push(options), status);
      static install = async () => true;
      // An accessor on the prototype, as the browser's attribute is. Playwright compiles a private
      // field to a helper the page does not have, so the value sits in a plain field.
      local = false;
      get processLocally() {
        return this.local;
      }
      set processLocally(value: boolean) {
        this.local = value;
      }
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((event: Results) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const { lang, continuous, interimResults, processLocally } = this;
        dictation.started.push({ lang, continuous, interimResults, processLocally });
        dictation.current = this;
      }
      stop() {
        dictation.current = undefined;
        this.onend?.();
      }
      abort() {
        dictation.aborted += 1;
        this.stop();
      }
    }
    scope.SpeechRecognition = FakeRecognition;
    scope.dictation = dictation;
  }, status);
}
export const stubbed = (page: Page, property: 'checked' | 'started' | 'aborted') =>
  page.evaluate(`window.dictation.${property}`);
export const hear = (page: Page, transcripts: string[]) =>
  page.evaluate(`window.dictation.hear(${JSON.stringify(transcripts)})`);
