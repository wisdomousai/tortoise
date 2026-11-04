import type { PolicyFinding } from '../policy';

/** Findings in the order they are reported, with helpers for errors and warnings. */
export function createFindings() {
  const findings: PolicyFinding[] = [];
  const add =
    (level: 'error' | 'warning') => (code: string, message: string, destination?: string) =>
      findings.push({ level, code, message, ...(destination ? { destination } : {}) });
  return { findings, error: add('error'), warn: add('warning') };
}
export type Findings = ReturnType<typeof createFindings>;
