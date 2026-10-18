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

type Model = { id: string; title: string };
type Work = (fn: () => Promise<void>) => Promise<void>;
type Select = (value: AgentSelection) => void;

/** Runs account operations, marking the panel busy and reporting any failure as a message. */
function useAccountWork(onError: (message: string) => void) {
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
  return { busy, work };
}

/** ChatGPT sign-in state: saved profiles, the chosen one, its models and a pending sign-in link. */
function useChatGptAccounts(work: Work, onSelect: Select) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [profileId, setProfileId] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  async function loadProfiles() {
    const result = await hostJson<{ profiles: Profile[] }>('providers/chatgpt/profiles', {});
    setProfiles(result.profiles);
    setAuthorizationUrl('');
  }
  return {
    profiles,
    models,
    profileId,
    authorizationUrl,
    loadProfiles: () => void work(loadProfiles),
    connect: () =>
      void work(async () => {
        const result = await hostJson<{ authorizationUrl: string }>(
          'providers/chatgpt/connect',
          {},
        );
        setAuthorizationUrl(result.authorizationUrl);
      }),
    chooseProfile(id: string) {
      setProfileId(id);
      setModels([]);
      if (id)
        void work(async () => {
          const result = await hostJson<{ models: Model[] }>('providers/chatgpt/models', {
            profileId: id,
          });
          setModels(result.models);
        });
    },
    chooseModel(model: string) {
      if (model)
        void work(async () => {
          await hostJson('providers/chatgpt/select', { profileId, model });
          onSelect({ harnessId: 'codex', profileId, model });
        });
    },
    disconnect: () =>
      void work(async () => {
        await hostJson('providers/chatgpt/disconnect', { profileId });
        onSelect({ harnessId: 'deterministic' });
        setProfileId('');
        setModels([]);
        await loadProfiles();
      }),
  };
}
type ChatGptAccounts = ReturnType<typeof useChatGptAccounts>;

function ChatGptSignIn({ accounts, busy }: { accounts: ChatGptAccounts; busy: boolean }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={accounts.connect}>
          Sign in with ChatGPT
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={accounts.loadProfiles}>
          Load saved accounts
        </Button>
      </div>
      {accounts.authorizationUrl && (
        <p>
          <a href={accounts.authorizationUrl} target="_blank" rel="noreferrer">
            Continue in your browser ↗
          </a>
          <br />
          <Button size="sm" variant="outline" disabled={busy} onClick={accounts.loadProfiles}>
            Refresh after signing in
          </Button>
        </p>
      )}
    </>
  );
}

function ChatGptProfilePicker({
  accounts,
  selection,
  busy,
}: {
  accounts: ChatGptAccounts;
  selection: AgentSelection;
  busy: boolean;
}) {
  return (
    <>
      <Label htmlFor="chatgpt-profile">ChatGPT account</Label>
      <NativeSelect
        id="chatgpt-profile"
        value={accounts.profileId}
        onChange={(event) => accounts.chooseProfile(event.target.value)}
      >
        <option value="">Select account</option>
        {accounts.profiles.map((profile) => (
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
      {accounts.models.length > 0 && (
        <>
          <Label htmlFor="chatgpt-model">Available model</Label>
          <NativeSelect
            id="chatgpt-model"
            value={selection.harnessId === 'codex' ? selection.model : ''}
            onChange={(event) => accounts.chooseModel(event.target.value)}
          >
            <option value="">Select model</option>
            {accounts.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.title}
              </option>
            ))}
          </NativeSelect>
        </>
      )}
      {accounts.profileId && (
        <Button size="sm" variant="outline" disabled={busy} onClick={accounts.disconnect}>
          Disconnect account
        </Button>
      )}
    </>
  );
}

/** A provider API key, stored by the instance; the field is cleared once it is sent. */
function ApiKeyAccount({ busy, work, onSelect }: { busy: boolean; work: Work; onSelect: Select }) {
  const [apiProvider, setApiProvider] = useState<'claude' | 'ai-sdk'>('claude');
  const [key, setKey] = useState('');
  const [apiModel, setApiModel] = useState('');
  return (
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
  );
}

const fundingOf = (selection: AgentSelection) =>
  selection.harnessId === 'deterministic'
    ? 'Demo'
    : selection.harnessId === 'codex'
      ? 'ChatGPT plan'
      : 'API key';

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
  const { busy, work } = useAccountWork(onError);
  const chatGpt = useChatGptAccounts(work, onSelect);
  return (
    <details className="space-y-2 rounded-lg border p-3 text-sm [&_summary]:cursor-pointer [&_summary]:font-medium">
      <summary>
        Agent account <span>{fundingOf(selection)}</span>
      </summary>
      <p className="text-muted-foreground">
        Choose how a model is funded. Your workspace permissions remain the same.
      </p>
      <ChatGptSignIn accounts={chatGpt} busy={busy} />
      {chatGpt.profiles.length > 0 && (
        <ChatGptProfilePicker accounts={chatGpt} selection={selection} busy={busy} />
      )}
      <ApiKeyAccount busy={busy} work={work} onSelect={onSelect} />
      <Button size="sm" variant="outline" onClick={() => onSelect({ harnessId: 'deterministic' })}>
        Use deterministic demo
      </Button>
    </details>
  );
}
