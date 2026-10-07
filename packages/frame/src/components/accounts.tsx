import { useState } from 'react';
import { hostJson } from '@/lib/host-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

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
    <details className="space-y-2 rounded-lg border p-3 text-sm [&_summary]:cursor-pointer [&_summary]:font-medium">
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
      <p className="text-muted-foreground">
        Choose how a model is funded. Your workspace permissions remain the same.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
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
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void work(loadProfiles)}>
          Load saved accounts
        </Button>
      </div>
      {authorizationUrl && (
        <p>
          <a href={authorizationUrl} target="_blank" rel="noreferrer">
            Continue in your browser ↗
          </a>
          <br />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void work(loadProfiles)}
          >
            Refresh after signing in
          </Button>
        </p>
      )}
      {profiles.length > 0 && (
        <>
          <Label htmlFor="chatgpt-profile">ChatGPT account</Label>
          <NativeSelect
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
          </NativeSelect>
          {models.length > 0 && (
            <>
              <Label htmlFor="chatgpt-model">Available model</Label>
              <NativeSelect
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
              </NativeSelect>
            </>
          )}
          {profileId && (
            <Button
              size="sm"
              variant="outline"
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
            </Button>
          )}
        </>
      )}
      <details className="space-y-2 rounded-md bg-muted/50 p-2">
        <summary>Use an API key</summary>
        <p className="text-muted-foreground">API-key usage is billed by the selected provider.</p>
        <Label htmlFor="key-provider">Provider</Label>
        <NativeSelect
          id="key-provider"
          value={apiProvider}
          onChange={(event) => {
            setApiProvider(event.target.value as typeof apiProvider);
            setKey('');
          }}
        >
          <option value="claude">Claude</option>
          <option value="ai-sdk">OpenAI via AI SDK</option>
        </NativeSelect>
        <Label htmlFor="api-model">Model ID</Label>
        <Input
          id="api-model"
          value={apiModel}
          onChange={(event) => setApiModel(event.target.value)}
          placeholder="Provider model ID"
        />
        <Label htmlFor="provider-key">API key</Label>
        <Input
          id="provider-key"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
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
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !apiModel}
            onClick={() =>
              void work(async () => {
                await hostJson(`providers/${apiProvider}/load`, {});
                onSelect({ harnessId: apiProvider, model: apiModel });
              })
            }
          >
            Use saved key
          </Button>
        </div>
      </details>
      <Button size="sm" variant="outline" onClick={() => onSelect({ harnessId: 'deterministic' })}>
        Use deterministic demo
      </Button>
    </details>
  );
}
