import { describe, expect, test } from 'bun:test';
import { buildCatalog } from '@agent-native/contracts';
import { buildInstruction, openActionFor } from '@agent-native/shell';
import { authorizationRequest } from '../src/chatgpt/authorization';
import { openAiComponent } from '../src/requirements';

const actions = buildCatalog([], { components: [openAiComponent] }).os!.actions;
const request = (profile?: { clientId: string; email: string }) =>
  authorizationRequest({
    hostId: 'urn:uuid:0f8fad5b-d9cb-469f-a165-70867728950e',
    redirectUri: 'http://127.0.0.1:4317/oauth/chatgpt/callback',
    appName: 'Notes',
    ...(profile ? { profile: profile as never } : {}),
  }).url;

describe('ChatGPT sign-in action', () => {
  test('the authorization URL is one the declared open action builds', () => {
    for (const url of [request(), request({ clientId: 'client_123', email: 'a@example.com' })]) {
      const match = openActionFor(actions, url.href);
      expect(match?.action).toBe('openai.authorize');
      const declared = openAiComponent.os!.actions![0]!;
      const rebuilt = buildInstruction(declared, match!.params, () => undefined);
      expect(rebuilt.kind === 'open' && new URL(rebuilt.url).searchParams.get('state')).toBe(
        url.searchParams.get('state'),
      );
    }
  });

  test('a different flow, endpoint or callback does not match', () => {
    const changed = (edit: (url: URL) => void) => {
      const url = request();
      edit(url);
      return openActionFor(actions, url.href);
    };
    expect(changed((url) => url.searchParams.set('response_type', 'token'))).toBeUndefined();
    expect(
      changed((url) => url.searchParams.set('code_challenge_method', 'plain')),
    ).toBeUndefined();
    expect(
      changed((url) => url.searchParams.set('redirect_uri', 'https://evil.example/callback')),
    ).toBeUndefined();
    expect(changed((url) => (url.pathname = '/api/accounts/other'))).toBeUndefined();
    expect(changed((url) => url.searchParams.append('prompt', 'none'))).toBeUndefined();
  });
});
