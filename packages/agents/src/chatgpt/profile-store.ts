import { randomUUID } from 'node:crypto';
import type { CredentialVault } from '../credentials';
import type { ChatGptCredentials, ChatGptProfile } from '../chatgpt';

export const issuer = 'https://auth.openai.com';

/** A profile as the vault keeps it: safe metadata plus the tokens that never leave the host. */
export type StoredProfile = ChatGptProfile & { tokens?: ChatGptCredentials };

/** The stable per-host identity sent with every authorization, created once. */
export async function hostId(vault: CredentialVault) {
  let id = await vault.get('chatgpt.host-id');
  if (!id) {
    id = `urn:uuid:${randomUUID()}`;
    await vault.set('chatgpt.host-id', id);
  }
  if (!/^urn:uuid:[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid stored host identity');
  return id;
}

export async function profileIds(vault: CredentialVault): Promise<string[]> {
  const raw = await vault.get('chatgpt.profiles');
  if (!raw) return [];
  const ids: unknown = JSON.parse(raw);
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))
  )
    throw new Error('Invalid stored profile index');
  return ids;
}

/** A registered profile, refused unless it is well formed and issued to a real client. */
export async function readProfile(vault: CredentialVault, id: string): Promise<StoredProfile> {
  if (!(await profileIds(vault)).includes(id)) throw new Error('Unknown ChatGPT profile');
  const raw = await vault.get(`chatgpt.profile.${id}`);
  if (!raw) throw new Error('ChatGPT profile is unavailable');
  const profile = JSON.parse(raw) as StoredProfile;
  if (
    profile.id !== id ||
    profile.issuer !== issuer ||
    !profile.subject ||
    !profile.clientId ||
    profile.clientId === 'dynamic_agent_client' ||
    !Array.isArray(profile.scopes)
  )
    throw new Error('Invalid stored ChatGPT profile');
  return profile;
}

/** The metadata of a profile without its tokens. */
export function safeProfile(profile: StoredProfile): ChatGptProfile {
  const { tokens: _tokens, ...metadata } = profile;
  return structuredClone(metadata);
}

export const writeProfile = (vault: CredentialVault, profile: StoredProfile) =>
  vault.set(`chatgpt.profile.${profile.id}`, JSON.stringify(profile));

/** Write a profile and register it in the index, removing the profile again if that fails. */
export async function saveEnrolledProfile(
  vault: CredentialVault,
  ids: readonly string[],
  profile: StoredProfile,
) {
  await writeProfile(vault, profile);
  if (!ids.includes(profile.id))
    try {
      await vault.set('chatgpt.profiles', JSON.stringify([...ids, profile.id]));
    } catch (error) {
      // OS vaults do not provide multi-entry transactions. Do not leave a newly
      // written renewable token behind after its registration index fails.
      await vault.remove(`chatgpt.profile.${profile.id}`).catch(() => false);
      throw error;
    }
}

/** The profile already enrolled for this issued client and subject, if any. */
export async function findEnrollment(
  vault: CredentialVault,
  ids: readonly string[],
  clientId: string,
  subject: string | undefined,
): Promise<StoredProfile | undefined> {
  // Re-enrollment of the same issued client/subject updates its one token record.
  let existing: StoredProfile | undefined;
  for (const id of ids) {
    const candidate = await readProfile(vault, id);
    if (candidate.clientId === clientId && candidate.subject === subject) existing = candidate;
  }
  return existing;
}
