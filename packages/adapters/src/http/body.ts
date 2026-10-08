import { ApplicationError } from '@agent-native/contracts';

/** Bounded JSON body parsing shared by domain and host routes. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApplicationError('INVALID_INPUT', 'JSON content type required');
  const reader = request.body?.getReader();
  if (!reader) throw new ApplicationError('INVALID_INPUT', 'JSON body required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1_048_576) {
        await reader.cancel();
        throw new ApplicationError('INVALID_INPUT', 'Request exceeds size limit');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApplicationError('INVALID_INPUT', 'JSON object required');
  }
}

export function parseRevisions(value: unknown): Record<string, number> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.values(value).some((item) => !Number.isSafeInteger(item) || Number(item) < 0)
  )
    throw new ApplicationError('INVALID_INPUT', 'Expected revisions must be nonnegative integers');
  return value as Record<string, number>;
}
