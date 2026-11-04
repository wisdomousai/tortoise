import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpTransport } from '@tortoise/client';
import { createMcpServer } from '@tortoise/adapters/mcp';
import { startHost } from '@tortoise/host/host';
import fieldService from '../application';

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
    [process.execPath, Bun.resolveSync('@tortoise/adapters/cli', import.meta.dir), ...args],
    { env: { PATH: process.env.PATH, TORTOISE_CONNECTION: file }, stdout: 'pipe' },
  );
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { exitCode, value: JSON.parse(stdout) };
}

const decode = (response: Awaited<ReturnType<Client['callTool']>>): any =>
  response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);

test('approving an approval runs its command as the approver on every surface, once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-approvals-'));
  const host = await startHost(fieldService, { workspacePath: join(directory, 'workspace') });
  const ownerToken = ((await Bun.file(host.connectionFile!).json()) as { token: string }).token;
  const owner = createHttpTransport({ baseUrl: host.url, token: ownerToken });
  const customerSession = host.sessions.create({ workspaceId: 'local', principalId: 'customer' });
  const customer = createHttpTransport({ baseUrl: host.url, token: customerSession.token });
  const customerFile = join(directory, 'customer-connection.json');
  await writeFile(
    customerFile,
    JSON.stringify({ endpoint: host.url, token: customerSession.token }),
    {
      mode: 0o600,
    },
  );
  const ownerMcp = await mcpClient(owner, 'owner-approvals');
  const customerMcp = await mcpClient(customer, 'customer-approvals');
  try {
    const workOrder = await owner.command<{ id: string; members: Record<string, string> }>(
      'work-order.create',
      { name: 'Planned' },
      { idempotencyKey: 'work-order' },
    );
    const ownerContext = {
      workspaceId: 'local',
      principalId: Object.keys(workOrder.result.members)[0]!,
    };
    await owner.command(
      'work-order.set-member',
      { id: workOrder.result.id, principalId: 'customer', role: 'customer' },
      { idempotencyKey: 'membership' },
    );
    // The customer requests approval for four tasks; customers may request approval but not create tasks.
    const ids: string[] = [];
    for (const title of ['Direct', 'HTTP', 'CLI', 'MCP'])
      ids.push(
        (
          await customer.command<{ id: string }>(
            'approval.request',
            {
              operation: 'task.create',
              input: { workOrderId: workOrder.result.id, title },
              rationale: `The brief lists ${title}.`,
              resource: `work-order:${workOrder.result.id}`,
            },
            { idempotencyKey: `request-${title}` },
          )
        ).result.id,
      );
    const [direct, http, commandLine, mcp] = ids as [string, string, string, string];

    // The requester's approval runs task.create as the customer, which the task rule refuses.
    await expect(
      host.application.invokeRaw(
        { operation: 'approval.approve', input: { id: direct }, idempotencyKey: 'v-direct' },
        customerSession.context,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      customer.command('approval.approve', { id: http }, { idempotencyKey: 'v-http' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const refusedCli = await cli(customerFile, [
      'approval.approve',
      '--json',
      JSON.stringify({ id: commandLine }),
      '--key',
      'v-cli',
    ]);
    expect(refusedCli.value.error.code).toBe('FORBIDDEN');
    const refusedMcp = await customerMcp.client.callTool({
      name: 'approval_approve',
      arguments: { input: { id: mcp }, idempotencyKey: 'v-mcp' },
    });
    expect(decode(refusedMcp).error.code).toBe('FORBIDDEN');
    expect(
      (await customer.query<{ total: number }>('approval.list', { status: 'pending' })).data.total,
    ).toBe(4);

    // The owner approves one approval request per surface; each creates its task as the owner.
    const approved = [
      await host.application.invokeRaw(
        { operation: 'approval.approve', input: { id: direct }, idempotencyKey: 'o-direct' },
        ownerContext,
      ),
      await owner.command('approval.approve', { id: http }, { idempotencyKey: 'o-http' }),
      (
        await cli(host.connectionFile!, [
          'approval.approve',
          '--json',
          JSON.stringify({ id: commandLine }),
          '--key',
          'o-cli',
        ])
      ).value,
      decode(
        await ownerMcp.client.callTool({
          name: 'approval_approve',
          arguments: { input: { id: mcp }, idempotencyKey: 'o-mcp' },
        }),
      ),
    ];
    expect(approved.map((receipt: any) => receipt.continuation.result.title)).toEqual([
      'Direct',
      'HTTP',
      'CLI',
      'MCP',
    ]);
    // A retry over another surface with the same key returns the same continuation.
    const retried = await owner.command(
      'approval.approve',
      { id: mcp },
      { idempotencyKey: 'o-mcp' },
    );
    expect(retried.continuation).toEqual(approved[3].continuation);
    const tasks = await owner.query<{ items: { title: string }[] }>('task.list', {});
    expect(tasks.data.items.map((task) => task.title).sort()).toEqual([
      'CLI',
      'Direct',
      'HTTP',
      'MCP',
    ]);
  } finally {
    await Promise.all([ownerMcp.close(), customerMcp.close()]);
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
