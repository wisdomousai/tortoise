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

test('direct, HTTP, CLI subprocess and MCP protocol share scoped results, errors and idempotent commits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-transport-'));
  const host = await startHost(fieldService, { workspacePath: join(directory, 'workspace') });
  const ownerConnection = (await Bun.file(host.connectionFile!).json()) as { token: string };
  const owner = createHttpTransport({ baseUrl: host.url, token: ownerConnection.token });
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
  const cli = async (file: string, args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, Bun.resolveSync('@tortoise/adapters/cli', import.meta.dir), ...args],
      {
        env: { PATH: process.env.PATH, AGENT_NATIVE_CONNECTION: file },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (!stdout.trim()) throw new Error(`CLI produced no JSON: ${stderr}`);
    return { exitCode, value: JSON.parse(stdout) };
  };
  const customerServer = createMcpServer(customer);
  const ownerServer = createMcpServer(owner);
  const customerMcp = new Client({ name: 'customer-conformance', version: '1.0.0' });
  const ownerMcp = new Client({ name: 'owner-conformance', version: '1.0.0' });
  const [customerClientTransport, customerServerTransport] = InMemoryTransport.createLinkedPair();
  const [ownerClientTransport, ownerServerTransport] = InMemoryTransport.createLinkedPair();
  const decode = (response: Awaited<ReturnType<Client['callTool']>>): any =>
    response.structuredContent ?? JSON.parse((response.content as { text: string }[])[0]!.text);
  try {
    await customerServer.connect(customerServerTransport);
    await customerMcp.connect(customerClientTransport);
    await ownerServer.connect(ownerServerTransport);
    await ownerMcp.connect(ownerClientTransport);
    const workOrder = await owner.command<{ id: string }>(
      'work-order.create',
      { name: 'Shared' },
      { idempotencyKey: 'work-order' },
    );
    const hidden = await owner.command<{ id: string }>(
      'work-order.create',
      { name: 'Hidden' },
      { idempotencyKey: 'hidden-workOrder' },
    );
    await owner.command(
      'work-order.set-member',
      { id: workOrder.result.id, principalId: 'customer', role: 'customer' },
      { idempotencyKey: 'membership' },
    );
    const task = await owner.command<{ id: string; revision: number }>(
      'task.create',
      { workOrderId: workOrder.result.id, title: 'Shared task', internalNote: 'TRANSPORT SECRET' },
      { idempotencyKey: 'task' },
    );
    await owner.command(
      'task.create',
      { workOrderId: hidden.result.id, title: 'Hidden task' },
      { idempotencyKey: 'hidden-task' },
    );
    const direct = await host.application.queryRaw(
      { operation: 'task.list', input: { limit: 1 } },
      customerSession.context,
    );
    const http = await customer.query('task.list', { limit: 1 });
    const commandLine = await cli(customerFile, ['task.list', '--json', '{"limit":1}']);
    const mcp = decode(
      await customerMcp.callTool({ name: 'task_list', arguments: { input: { limit: 1 } } }),
    );
    expect(http.data).toEqual(direct.data);
    expect(commandLine.exitCode).toBe(0);
    expect(commandLine.value.data).toEqual(direct.data);
    expect(mcp.data).toEqual(direct.data);
    expect(JSON.stringify(mcp)).not.toContain('TRANSPORT SECRET');
    expect((mcp.data as { count: number }).count).toBe(1);
    const deniedInput = { id: task.result.id, title: 'Forbidden edit' };
    await expect(
      host.application.invokeRaw(
        { operation: 'task.update', input: deniedInput, idempotencyKey: 'direct-denied' },
        customerSession.context,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      customer.command('task.update', deniedInput, { idempotencyKey: 'http-denied' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const deniedCli = await cli(customerFile, [
      'task.update',
      '--json',
      JSON.stringify(deniedInput),
      '--key',
      'cli-denied',
    ]);
    expect(deniedCli.exitCode).toBe(4);
    expect(deniedCli.value.error.code).toBe('FORBIDDEN');
    const deniedMcp = await customerMcp.callTool({
      name: 'task_update',
      arguments: { input: deniedInput, idempotencyKey: 'mcp-denied' },
    });
    expect(deniedMcp.isError).toBe(true);
    expect(decode(deniedMcp).error.code).toBe('FORBIDDEN');
    const input = { id: task.result.id, title: 'One committed edit' };
    const revisions = { [`task:${task.result.id}`]: task.result.revision };
    const committed = await owner.command('task.update', input, {
      idempotencyKey: 'shared-key',
      expectedRevisions: revisions,
    });
    const retryCli = await cli(host.connectionFile!, [
      'task.update',
      '--json',
      JSON.stringify(input),
      '--key',
      'shared-key',
      '--revisions',
      JSON.stringify(revisions),
    ]);
    const retryMcp = decode(
      await ownerMcp.callTool({
        name: 'task_update',
        arguments: { input, idempotencyKey: 'shared-key', expectedRevisions: revisions },
      }),
    );
    expect(retryCli.exitCode).toBe(0);
    expect(retryCli.value.result).toEqual(committed.result);
    expect(retryMcp.result).toEqual(committed.result);
    expect(retryMcp.revisions).toEqual(committed.revisions);
    const final = await owner.query<{ revision: number }>('task.get', { id: task.result.id });
    expect(final.data.revision).toBe(task.result.revision + 1);
  } finally {
    await customerMcp.close();
    await ownerMcp.close();
    await customerServer.close();
    await ownerServer.close();
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
