import { useState } from 'react';
import { hostJson } from './host-client';

export interface AgentSelection {
  harnessId: 'deterministic' | 'codex' | 'claude' | 'ai-sdk';
  profileId?: string;
  model?: string;
}
type Profile = {
  id: string;
  email?: string;
  subject: string;
  connected: boolean;
  planUsageEnabled: boolean;
};

/** Account access is deliberate. Rendering this component never reads the OS vault. */
export function Accounts({
  selection,
  onSelect,
  onError,
}: {
  selection: AgentSelection;
  onSelect: (value: AgentSelection) => void;
  onError: (message: string) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [models, setModels] = useState<{ id: string; title: string }[]>([]);
  const [profileId, setProfileId] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [apiProvider, setApiProvider] = useState<'claude' | 'ai-sdk'>('claude');
  const [key, setKey] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [busy, setBusy] = useState(false);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Account operation failed');
    } finally {
      setBusy(false);
    }
  }
  async function loadProfiles() {
    const result = await hostJson<{ profiles: Profile[] }>('providers/chatgpt/profiles', {});
    setProfiles(result.profiles);
    setAuthorizationUrl('');
  }
  return (
    <details className="accounts">
      <summary>
        Agent account{' '}
        <span>
          {selection.harnessId === 'deterministic'
            ? 'Demo'
            : selection.harnessId === 'codex'
              ? 'ChatGPT plan'
              : 'API key'}
        </span>
      </summary>
      <p>Choose how a model is funded. Your workspace permissions remain the same.</p>
      <div className="account-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void work(async () => {
              const result = await hostJson<{ authorizationUrl: string }>(
                'providers/chatgpt/connect',
                {},
              );
              setAuthorizationUrl(result.authorizationUrl);
            })
          }
        >
          Sign in with ChatGPT
        </button>
        <button className="secondary" disabled={busy} onClick={() => void work(loadProfiles)}>
          Load saved accounts
        </button>
      </div>
      {authorizationUrl && (
        <p>
          <a href={authorizationUrl} target="_blank" rel="noreferrer">
            Continue in your browser ↗
          </a>
          <br />
          <button className="secondary" disabled={busy} onClick={() => void work(loadProfiles)}>
            Refresh after signing in
          </button>
        </p>
      )}
      {profiles.length > 0 && (
        <>
          <label htmlFor="chatgpt-profile">ChatGPT account</label>
          <select
            id="chatgpt-profile"
            value={profileId}
            onChange={(event) => {
              const id = event.target.value;
              setProfileId(id);
              setModels([]);
              if (id)
                void work(async () => {
                  const result = await hostJson<{ models: { id: string; title: string }[] }>(
                    'providers/chatgpt/models',
                    { profileId: id },
                  );
                  setModels(result.models);
                });
            }}
          >
            <option value="">Select account</option>
            {profiles.map((profile) => (
              <option
                key={profile.id}
                value={profile.id}
                disabled={!profile.connected || !profile.planUsageEnabled}
              >
                {profile.email ?? profile.subject}{' '}
                {!profile.planUsageEnabled ? '(plan access unavailable)' : ''}
              </option>
            ))}
          </select>
          {models.length > 0 && (
            <>
              <label htmlFor="chatgpt-model">Available model</label>
              <select
                id="chatgpt-model"
                value={selection.harnessId === 'codex' ? selection.model : ''}
                onChange={(event) => {
                  const model = event.target.value;
                  if (model)
                    void work(async () => {
                      await hostJson('providers/chatgpt/select', { profileId, model });
                      onSelect({ harnessId: 'codex', profileId, model });
                    });
                }}
              >
                <option value="">Select model</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.title}
                  </option>
                ))}
              </select>
            </>
          )}
          {profileId && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await hostJson('providers/chatgpt/disconnect', { profileId });
                  onSelect({ harnessId: 'deterministic' });
                  setProfileId('');
                  setModels([]);
                  await loadProfiles();
                })
              }
            >
              Disconnect account
            </button>
          )}
        </>
      )}
      <details>
        <summary>Use an API key</summary>
        <p>API-key usage is billed by the selected provider.</p>
        <label htmlFor="key-provider">Provider</label>
        <select
          id="key-provider"
          value={apiProvider}
          onChange={(event) => {
            setApiProvider(event.target.value as typeof apiProvider);
            setKey('');
          }}
        >
          <option value="claude">Claude</option>
          <option value="ai-sdk">OpenAI via AI SDK</option>
        </select>
        <label htmlFor="api-model">Model ID</label>
        <input
          id="api-model"
          value={apiModel}
          onChange={(event) => setApiModel(event.target.value)}
          placeholder="Provider model ID"
        />
        <label htmlFor="provider-key">API key</label>
        <input
          id="provider-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <div className="account-actions">
          <button
            className="secondary"
            disabled={busy || !key || !apiModel}
            onClick={() =>
              void work(async () => {
                try {
                  await hostJson(`providers/${apiProvider}/key`, { key });
                  onSelect({ harnessId: apiProvider, model: apiModel });
                } finally {
                  setKey('');
                }
              })
            }
          >
            Store and select key
          </button>
          <button
            className="secondary"
            disabled={busy || !apiModel}
            onClick={() =>
              void work(async () => {
                await hostJson(`providers/${apiProvider}/load`, {});
                onSelect({ harnessId: apiProvider, model: apiModel });
              })
            }
          >
            Use saved key
          </button>
        </div>
      </details>
      <button className="secondary" onClick={() => onSelect({ harnessId: 'deterministic' })}>
        Use deterministic demo
      </button>
    </details>
  );
}
