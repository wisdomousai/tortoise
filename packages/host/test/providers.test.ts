import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Sessions } from '@agent-native/adapters/http';
import { MemoryCredentialVault } from '@agent-native/agents/credentials';
import type { ChatGptProfile } from '@agent-native/agents/chatgpt';
import type { Harness, HarnessTurn } from '@agent-native/agents/types';
import type { CodexOptions } from '@agent-native/agents/codex';
import { createProviderAccess } from '../src/providers';

const origin = 'http://127.0.0.1:41000';
const profileId = '11111111-1111-4111-8111-111111111111';
class CountingVault extends MemoryCredentialVault {
  reads = 0;
  writes = 0;
  override async get(account: string) {
    this.reads++;
    return super.get(account);
  }
  override async set(account: string, value: string) {
    this.writes++;
    return super.set(account, value);
  }
}
const request = (path: string, body?: unknown) =>
  new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: new URL(origin).host,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const fakeHarness = (id: string): Harness => ({
  id,
  features: { questions: false, approvals: false, resume: false },
  async availability() {
    return { available: true };
  },
  async *run() {
    yield { type: 'text', text: 'fixture completed' };
  },
});
function turn(context: Record<string, unknown>): HarnessTurn {
  return {
    context,
    runId: 'fixed-run',
    conversationId: 'conversation',
    prompt: 'Fixture only',
    signal: new AbortController().signal,
    tools: {
      async execute() {
        return {};
      },
    },
    async question() {
      return '';
    },
    async approve() {
      return false;
    },
  };
}
async function collect(harness: Harness, context: Record<string, unknown>) {
  const events = [];
  for await (const event of harness.run(turn(context))) events.push(event);
  return events;
}
async function runtimeManifest(directory: string) {
  await mkdir(join(directory, 'runtimes'));
  await mkdir(join(directory, 'web'));
  const bytes = new Uint8Array([0xff, 0x00, 0x80, 0x31]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  for (const name of ['runtimes/codex', 'runtimes/claude', 'service']) {
    await writeFile(join(directory, name), bytes);
    await chmod(join(directory, name), 0o700);
  }
  const path = join(directory, 'runtime-manifest.json');
  await writeFile(
    path,
    JSON.stringify({
      format: 1,
      target: `${process.platform}-${process.arch}`,
      webRoot: 'web',
      service: { executable: 'service', sha256 },
      runtimes: {
        codex: {
          executable: 'runtimes/codex',
          version: 'fixture',
          files: [{ path: 'runtimes/codex', sha256 }],
        },
        claude: {
          executable: 'runtimes/claude',
          version: 'fixture',
          files: [{ path: 'runtimes/claude', sha256 }],
        },
      },
    }),
  );
  return path;
}
async function fixture(native = false) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-provider-'));
  const vault = new CountingVault();
  const sessions = new Sessions();
  const owner = sessions.create({ workspaceId: 'local', principalId: 'owner' });
  let began = 0;
  let completed = 0;
  let refreshed = 0;
  let nativeOptions: CodexOptions | undefined;
  let apiOptions: { apiKey: string; model: string } | undefined;
  const profile: ChatGptProfile = {
    id: profileId,
    clientId: 'issued-client',
    subject: 'verified-subject',
    issuer: 'https://auth.openai.com',
    email: 'fixture@example.test',
    connected: true,
    planUsageEnabled: true,
    scopes: ['chatgpt.tokens.use.direct'],
    expiresAt: Date.now() + 3_600_000,
  };
  const account = {
    async begin(token: string) {
      expect(token).toBe(owner.token);
      began++;
      return {
        authorizationUrl: `https://auth.openai.com/api/accounts/authorize?state=state-${began}`,
        expiresAt: Date.now() + 300_000,
      };
    },
    async complete(_url: string, token: string) {
      expect(token).toBe(owner.token);
      completed++;
      return profile;
    },
    async profiles() {
      return [{ ...profile, accidentallyIncludedToken: 'SECRET' }];
    },
    async credentials() {
      return {
        accessToken: 'ACCESS-TOKEN-SECRET',
        idToken: 'ID-TOKEN-SECRET',
        refreshToken: 'REFRESH-TOKEN-SECRET',
        expiresAt: profile.expiresAt!,
      };
    },
    async refresh() {
      refreshed++;
      profile.expiresAt = Date.now() + 3_600_000;
      return profile;
    },
    async logout() {
      profile.connected = false;
      return { revocationConfirmed: false };
    },
  };
  const access = await createProviderAccess({
    workspacePath: directory,
    origin,
    sessions: (token) => sessions.get(token),
    vault,
    runtimeManifest: native ? await runtimeManifest(directory) : undefined,
    fetch: (async (url, options) => {
      expect(String(url)).toBe('https://api.openai.com/v1/models');
      expect(new Headers(options?.headers).get('authorization')).toBe('Bearer ACCESS-TOKEN-SECRET');
      return Response.json({
        models: [
          {
            slug: 'fixture-model',
            display_name: 'Fixture Model',
            visibility: 'list',
            internal_secret: 'SECRET',
          },
          { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hide' },
        ],
      });
    }) as typeof fetch,
    factories: {
      chatgpt: () => account,
      codex: (options) => {
        nativeOptions = options;
        return fakeHarness('codex');
      },
      aiSdk: (options) => {
        apiOptions = options;
        return fakeHarness('ai-sdk');
      },
    },
  });
  return {
    access,
    owner,
    vault,
    sessions,
    directory,
    profile,
    account,
    get completed() {
      return completed;
    },
    get refreshed() {
      return refreshed;
    },
    get nativeOptions() {
      return nativeOptions;
    },
    get apiOptions() {
      return apiOptions;
    },
    async close() {
      access.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('startup, provider status and availability never read credentials; management rejects delegated or stale sessions', async () => {
  const f = await fixture();
  try {
    const response = await f.access.route(request('/api/v1/providers'), f.owner);
    expect(response?.status).toBe(200);
    for (const harness of f.access.harnesses) await harness.availability();
    expect(f.vault.reads).toBe(0);
    expect(f.vault.writes).toBe(0);
    const delegated = f.sessions.create({
      workspaceId: 'local',
      principalId: 'owner',
      grant: { operations: ['task.list'] },
    });
    await expect(f.access.route(request('/api/v1/providers'), delegated)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(f.access.resolveSelection(delegated, { harnessId: 'deterministic' })).toEqual({});
    f.sessions.revoke(f.owner.token);
    await expect(f.access.route(request('/api/v1/providers'), f.owner)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  } finally {
    await f.close();
  }
});

test('OAuth callback binds to its originating live session, is single use, and never returns tokens', async () => {
  const f = await fixture();
  try {
    const result = await f.access.route(request('/api/v1/providers/chatgpt/connect', {}), f.owner);
    expect(result?.status).toBe(200);
    const callback = request(
      '/oauth/chatgpt/callback?state=state-1&code=code&client_id=issued-client',
    );
    const complete = await f.access.callback(callback);
    expect(complete?.status).toBe(200);
    expect(await complete!.text()).not.toContain('SECRET');
    expect(f.completed).toBe(1);
    expect((await f.access.callback(callback))?.status).toBe(400);
    await f.access.route(request('/api/v1/providers/chatgpt/connect', {}), f.owner);
    f.sessions.revoke(f.owner.token);
    expect(
      (await f.access.callback(request('/oauth/chatgpt/callback?state=state-2&code=code')))?.status,
    ).toBe(400);
    expect(f.completed).toBe(1);
  } finally {
    await f.close();
  }
});

test('explicit profile models are account-specific, visible-only and safe; lazy Codex uses selected fresh tokens and isolated native paths', async () => {
  const f = await fixture(true);
  try {
    const listed = await f.access.route(request('/api/v1/providers/chatgpt/profiles', {}), f.owner);
    expect(await listed!.text()).not.toContain('SECRET');
    const response = await f.access.route(
      request('/api/v1/providers/chatgpt/models', { profileId }),
      f.owner,
    );
    expect(await response!.json()).toEqual({
      models: [{ id: 'fixture-model', title: 'Fixture Model' }],
      inferenceVerified: false,
    });
    await f.access.route(
      request('/api/v1/providers/chatgpt/select', { profileId, model: 'fixture-model' }),
      f.owner,
    );
    expect(f.access.resolveSelection(f.owner, { harnessId: 'codex' })).toEqual({
      profileId,
      model: 'fixture-model',
    });
    expect(() =>
      f.access.resolveSelection(f.owner, { harnessId: 'codex', profileId, model: 'hidden-model' }),
    ).toThrow();
    const anotherWorkspace = f.sessions.create({ workspaceId: 'other', principalId: 'owner' });
    expect(() =>
      f.access.resolveSelection(anotherWorkspace, {
        harnessId: 'codex',
        profileId,
        model: 'fixture-model',
      }),
    ).toThrow();
    f.profile.expiresAt = Date.now() + 1000;
    await f.access.route(request('/api/v1/providers/chatgpt/profiles', {}), f.owner);
    const context = {
      principalId: 'owner',
      workspaceId: 'local',
      ...f.access.resolveSelection(f.owner, { harnessId: 'codex' }),
    };
    expect(
      await collect(
        f.access.harnesses.find((harness) => harness.id === 'codex')!,
        context,
      ),
    ).toEqual([{ type: 'text', text: 'fixture completed' }]);
    expect(f.refreshed).toBe(1);
    expect(f.nativeOptions?.environment).toEqual({ ACCESS_TOKEN: 'ACCESS-TOKEN-SECRET' });
    expect(f.nativeOptions?.modelProvider).toBe('openai_chatgpt_plan');
    expect(f.nativeOptions?.model).toBe('fixture-model');
    const canonicalDirectory = await realpath(f.directory);
    expect(f.nativeOptions?.cwd.startsWith(canonicalDirectory)).toBe(true);
    expect(f.nativeOptions?.home.startsWith(canonicalDirectory)).toBe(true);
    const firstHome = f.nativeOptions?.home;
    const firstCwd = f.nativeOptions?.cwd;
    for await (const _event of f.access.harnesses
      .find((harness) => harness.id === 'codex')!
      .run({ ...turn(context), runId: 'next-run' })) {
      /* fixture only */
    }
    expect(f.nativeOptions?.home).toBe(firstHome);
    expect(f.nativeOptions?.cwd).not.toBe(firstCwd);
    expect(JSON.stringify(context)).not.toContain('SECRET');
    await writeFile(join(f.directory, 'runtimes/codex'), 'tampered');
    await expect(
      collect(
        f.access.harnesses.find((harness) => harness.id === 'codex')!,
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  } finally {
    await f.close();
  }
});

test('API-key funding requires explicit save/load and cannot fall back to plan credentials', async () => {
  const f = await fixture();
  try {
    expect(() =>
      f.access.resolveSelection(f.owner, { harnessId: 'ai-sdk', model: 'fixture-model' }),
    ).toThrow();
    await f.access.route(
      request('/api/v1/providers/ai-sdk/key', { key: 'EXPLICIT-API-KEY-SECRET' }),
      f.owner,
    );
    const selection = f.access.resolveSelection(f.owner, {
      harnessId: 'ai-sdk',
      model: 'fixture-model',
    });
    expect(selection).toEqual({ providerAccount: 'ai-sdk-api', model: 'fixture-model' });
    await collect(
      f.access.harnesses.find((harness) => harness.id === 'ai-sdk')!,
      { principalId: 'owner', workspaceId: 'local', ...selection },
    );
    expect(f.apiOptions).toEqual({ apiKey: 'EXPLICIT-API-KEY-SECRET', model: 'fixture-model' });
    expect(
      await (await f.access.route(request('/api/v1/providers'), f.owner))!.text(),
    ).not.toContain('SECRET');
    await f.access.route(request('/api/v1/providers/ai-sdk/disconnect', {}), f.owner);
    await expect(
      collect(
        f.access.harnesses.find((harness) => harness.id === 'ai-sdk')!,
        { principalId: 'owner', workspaceId: 'local', ...selection },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.close();
  }
});

test('provider catalog and inference failures discard provider exception text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-provider-error-'));
  const sessions = new Sessions();
  const owner = sessions.create({ workspaceId: 'local', principalId: 'owner' });
  const vault = new CountingVault();
  const access = await createProviderAccess({
    workspacePath: directory,
    origin,
    sessions: (token) => sessions.get(token),
    vault,
    factories: {
      aiSdk: () => {
        throw new Error('API-TOKEN-SECRET');
      },
    },
  });
  try {
    await access.route(
      request('/api/v1/providers/ai-sdk/key', { key: 'EXPLICIT-API-KEY-SECRET' }),
      owner,
    );
    const selection = access.resolveSelection(owner, {
      harnessId: 'ai-sdk',
      model: 'fixture-model',
    });
    try {
      await collect(
        access.harnesses.find((harness) => harness.id === 'ai-sdk')!,
        { principalId: 'owner', workspaceId: 'local', ...selection },
      );
      throw new Error('Unexpected success');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INTERNAL' });
      expect(String(error)).not.toContain('SECRET');
    }
  } finally {
    access.close();
    await rm(directory, { recursive: true, force: true });
  }
});
