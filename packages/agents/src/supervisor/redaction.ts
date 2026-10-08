const tokenPatterns = [
  /\bBearer\s+[\w.\-]+/gi,
  /\b(?:sk|sk-ant)-[\w\-]{8,}/g,
  /("?(?:access_token|refresh_token|api_key|id_token)"?\s*[:=]\s*")[^"]*/gi,
];

/**
 * Redaction of the explicitly supplied secrets and of common token shapes. `scrub` replaces
 * them; `safeCut` says how much of streamed text may be released now.
 */
export function createRedactor(redact: readonly string[] = []) {
  const secrets = redact.filter(Boolean);
  const scrub = (value: string) => {
    let result = value;
    for (const secret of secrets) result = result.split(secret).join('[redacted]');
    return result
      .replace(tokenPatterns[0]!, 'Bearer [redacted]')
      .replace(tokenPatterns[1]!, '[redacted]')
      .replace(tokenPatterns[2]!, '$1[redacted]');
  };
  // Streamed text is redacted across deltas: a tail that may still be the start of a secret or
  // token stays raw in memory until the next delta or a flush, and is never persisted unscrubbed.
  const holdBack = Math.max(64, ...secrets.map((secret) => secret.length - 1));
  function safeCut(text: string) {
    let cut = Math.max(0, text.length - holdBack);
    const hold = (start: number, end: number) => {
      if (start < cut && (end > cut || end === text.length)) cut = start;
    };
    for (const secret of secrets)
      for (let at = text.indexOf(secret); at !== -1; at = text.indexOf(secret, at + 1))
        hold(at, at + secret.length);
    for (const pattern of tokenPatterns)
      for (const match of text.matchAll(pattern)) hold(match.index, match.index + match[0].length);
    // A carry this large cannot be a pending secret prefix; release it rather than grow.
    return text.length - cut > 16_000 ? text.length : cut;
  }
  return { scrub, safeCut };
}
export type Redactor = ReturnType<typeof createRedactor>;
