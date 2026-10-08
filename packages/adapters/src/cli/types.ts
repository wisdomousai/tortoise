import type { Transport } from '@agent-native/client';
import type { Catalog } from '@agent-native/contracts';

/** Help and workflow text printed verbatim instead of as a JSON value. */
export class CliText {
  constructor(readonly text: string) {}
}

export type CliClient = Transport & { catalog(): Promise<Catalog> };
export interface CliOptions {
  /** Name shown in usage text; the compiled binary passes its application name. */
  readonly program?: string;
  /** Source for `--json -`. Never read implicitly, so a harness cannot hang on an open stdin. */
  readonly readStdin?: () => Promise<string>;
}
