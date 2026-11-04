import { ApplicationError } from '@tortoise/contracts';
import type { ChatGptProfile } from '@tortoise/agents/chatgpt';

export function validModel(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value))
    throw new ApplicationError('INVALID_INPUT', 'Select a valid model');
  return value;
}

export function validProfileId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value))
    throw new ApplicationError('INVALID_INPUT', 'Select a valid profile');
  return value;
}

/** Copy only the safe, typed metadata of a profile; anything else is refused. */
export function safeProfile(profile: ChatGptProfile): ChatGptProfile {
  if (
    typeof profile.id !== 'string' ||
    typeof profile.clientId !== 'string' ||
    typeof profile.subject !== 'string' ||
    profile.issuer !== 'https://auth.openai.com' ||
    typeof profile.connected !== 'boolean' ||
    typeof profile.planUsageEnabled !== 'boolean' ||
    !Array.isArray(profile.scopes) ||
    profile.scopes.some((scope) => typeof scope !== 'string') ||
    (profile.email !== undefined && typeof profile.email !== 'string') ||
    (profile.expiresAt !== undefined && !Number.isFinite(profile.expiresAt))
  )
    throw new Error('Invalid safe provider metadata');
  return {
    id: profile.id,
    clientId: profile.clientId,
    subject: profile.subject,
    issuer: profile.issuer,
    connected: profile.connected,
    planUsageEnabled: profile.planUsageEnabled,
    scopes: [...profile.scopes],
    ...(profile.email === undefined ? {} : { email: profile.email }),
    ...(profile.expiresAt === undefined ? {} : { expiresAt: profile.expiresAt }),
  };
}

/** Read a JSON object body of at most 32 000 bytes. */
export async function readProviderBody(request: Request): Promise<Record<string, unknown>> {
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
      if (size > 32_000) {
        await reader.cancel();
        throw new ApplicationError('INVALID_INPUT', 'Provider request exceeds limit');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApplicationError('INVALID_INPUT', 'JSON object required');
  }
}
