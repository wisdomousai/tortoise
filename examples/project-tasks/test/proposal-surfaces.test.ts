import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@agent-native/client';
import { createMcpServer } from '@agent-native/adapters/mcp';
import { startHost } from '@agent-native/host/host';
import projectTasks from '../application';

type Http = ReturnType<typeof createHttpTransport>;

/** Connect an MCP client to a server over `transport`. */
async function mcpClient(transport: Http, name: string) {
  const server = createMcpServer(transport);
  const client = new Client({ name, version: '1.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

async function cli(file: string, args: string[]) {
  const child = Bun.spawn(
    [process.execPath, Bun.resolveSync('@agent-native/adapters/cli', import.meta.dir), ...args],
    { env: { PATH: process.env.PATH, AGENT_NATIVE_CONNECTION: file }, stdout: 'pipe' },
  );
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { exitCode, value: JSON.parse(stdout) };
}

const decode = (response: Awaited<ReturnType<Client['callTool']>>): any =>
  response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);

test('accepting a proposal runs its command as the accepter on every surface, once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-proposals-'));
  const host = await startHost(projectTasks, { workspacePath: join(directory, 'workspace') });
  const ownerToken = ((await Bun.file(host.connectionFile!).json()) as { token: string }).token;
  const owner = createHttpTransport({ baseUrl: host.url, token: ownerToken });
  const viewerSession = host.sessions.create({ workspaceId: 'local', principalId: 'viewer' });
  const viewer = createHttpTransport({ baseUrl: host.url, token: viewerSession.token });
  const viewerFile = join(directory, 'viewer-connection.json');
  await writeFile(viewerFile, JSON.stringify({ endpoint: host.url, token: viewerSession.token }), {
    mode: 0o600,
  });
  const ownerMcp = await mcpClient(owner, 'owner-proposals');
  const viewerMcp = await mcpClient(viewer, 'viewer-proposals');
  try {
    const project = await owner.command<{ id: string; members: Record<string, string> }>(
      'project.create',
      { name: 'Planned' },
      { idempotencyKey: 'project' },
    );
    const ownerContext = {
      workspaceId: 'local',
      principalId: Object.keys(project.result.members)[0]!,
    };
    await owner.command(
      'project.set-member',
      { id: project.result.id, principalId: 'viewer', role: 'viewer' },
      { idempotencyKey: 'membership' },
    );
    // The viewer proposes four tasks; viewers may propose but not create tasks.
    const ids: string[] = [];
    for (const title of ['Direct', 'HTTP', 'CLI', 'MCP'])
      ids.push(
        (
          await viewer.command<{ id: string }>(
            'proposal.submit',
            {
              operation: 'task.create',
              input: { projectId: project.result.id, title },
              rationale: `The brief lists ${title}.`,
              resource: `project:${project.result.id}`,
            },
            { idempotencyKey: `propose-${title}` },
          )
        ).result.id,
      );
    const [direct, http, commandLine, mcp] = ids as [string, string, string, string];

    // The proposer's acceptance runs task.create as the viewer, which the task rule refuses.
    await expect(
      host.application.invokeRaw(
        { operation: 'proposal.accept', input: { id: direct }, idempotencyKey: 'v-direct' },
        viewerSession.context,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      viewer.command('proposal.accept', { id: http }, { idempotencyKey: 'v-http' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const refusedCli = await cli(viewerFile, [
      'proposal.accept',
      '--json',
      JSON.stringify({ id: commandLine }),
      '--key',
      'v-cli',
    ]);
    expect(refusedCli.value.error.code).toBe('FORBIDDEN');
    const refusedMcp = await viewerMcp.client.callTool({
      name: 'proposal_accept',
      arguments: { input: { id: mcp }, idempotencyKey: 'v-mcp' },
    });
    expect(decode(refusedMcp).error.code).toBe('FORBIDDEN');
    expect(
      (await viewer.query<{ total: number }>('proposal.list', { status: 'open' })).data.total,
    ).toBe(4);

    // The owner accepts one proposal per surface; each creates its task as the owner.
    const accepted = [
      await host.application.invokeRaw(
        { operation: 'proposal.accept', input: { id: direct }, idempotencyKey: 'o-direct' },
        ownerContext,
      ),
      await owner.command('proposal.accept', { id: http }, { idempotencyKey: 'o-http' }),
      (
        await cli(host.connectionFile!, [
          'proposal.accept',
          '--json',
          JSON.stringify({ id: commandLine }),
          '--key',
          'o-cli',
        ])
      ).value,
      decode(
        await ownerMcp.client.callTool({
          name: 'proposal_accept',
          arguments: { input: { id: mcp }, idempotencyKey: 'o-mcp' },
        }),
      ),
    ];
    expect(accepted.map((receipt: any) => receipt.continuation.result.title)).toEqual([
      'Direct',
      'HTTP',
      'CLI',
      'MCP',
    ]);
    // A retry over another surface with the same key returns the same continuation.
    const retried = await owner.command(
      'proposal.accept',
      { id: mcp },
      { idempotencyKey: 'o-mcp' },
    );
    expect(retried.continuation).toEqual(accepted[3].continuation);
    const tasks = await owner.query<{ items: { title: string }[] }>('task.list', {});
    expect(tasks.data.items.map((task) => task.title).sort()).toEqual([
      'CLI',
      'Direct',
      'HTTP',
      'MCP',
    ]);
  } finally {
    await Promise.all([ownerMcp.close(), viewerMcp.close()]);
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
