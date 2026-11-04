import { test, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startService } from '../../../../tests/e2e/service';

test('UI, external MCP and deterministic agent share live state; drafts retain their base revision', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tortoise-e2e-'));
  let host: Awaited<ReturnType<typeof startService>> | undefined;
  let mcp: Client | undefined;
  try {
    host = await startService('@tortoise/field-service', workspace);
    await page.goto(host.launchUrl);
    await page.getByLabel('New work order').fill('Boiler B1 service');
    await page.getByRole('button', { name: 'Create work order', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Boiler B1 service' })).toBeVisible();
    mcp = new Client({ name: 'parity-acceptance', version: '1.0.0' });
    await mcp.connect(
      new StdioClientTransport({
        command: 'bun',
        args: ['packages/adapters/src/mcp.ts'],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? '', TORTOISE_CONNECTION: host.connectionFile },
      }),
    );
    const tools = await mcp.listTools();
    // The instance hosts one application: the field-service capabilities (14), the approval
    // feature's operations (6), the compliance queries (3), the notifications plugin's operations (3) and
    // the webhook plugin's operations (2). Policy keeps the plugin-only ones from any caller.
    expect(tools.tools.length).toBe(28);
    const workOrders = await mcp.callTool({ name: 'work_order_list', arguments: { input: {} } });
    const data = workOrders.structuredContent as { data: { items: { id: string }[] } };
    const workOrderId = data.data.items[0]!.id;
    const created = await mcp.callTool({
      name: 'task_create',
      arguments: {
        input: { workOrderId, title: 'Created through MCP' },
        idempotencyKey: 'mcp-create',
      },
    });
    expect(created.isError).toBeUndefined();
    const task = (created.structuredContent as { result: { id: string; revision: number } }).result;
    await expect(
      page.getByRole('button', { name: 'Created through MCP', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Created through MCP', exact: true }).click();
    await page.getByLabel('Edit task title').fill('My unsaved draft');
    const changed = await mcp.callTool({
      name: 'task_update',
      arguments: {
        input: { id: task.id, title: 'Changed by an external agent' },
        idempotencyKey: 'mcp-update',
        expectedRevisions: { [`task:${task.id}`]: task.revision },
      },
    });
    expect(changed.isError).toBeUndefined();
    await expect(page.getByText('Changed elsewhere. Your draft is preserved.')).toBeVisible();
    await expect(page.getByLabel('Edit task title')).toHaveValue('My unsaved draft');
    await page.getByRole('button', { name: 'Use latest revision' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'My unsaved draft', exact: true })).toBeVisible();
    const observed = await mcp.callTool({
      name: 'task_get',
      arguments: { input: { id: task.id } },
    });
    expect((observed.structuredContent as { data: { title: string } }).data.title).toBe(
      'My unsaved draft',
    );
    await page
      .getByLabel('Work order brief')
      .fill('Isolate the pump\nReplace the seal\nTest under pressure');
    await page.getByRole('button', { name: /Create tasks from brief/ }).click();
    await expect(
      page.getByRole('button', { name: 'Test under pressure', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('succeeded', { exact: true })).toBeVisible();
    const questionRun = await page.request.post(`${host.origin}/api/v1/runs`, {
      headers: { Origin: host.origin },
      data: {
        harnessId: 'deterministic',
        prompt: JSON.stringify({ commands: [], question: 'Name the next step' }),
      },
    });
    expect(questionRun.status()).toBe(202);
    await expect(page.getByLabel('Answer agent question')).toBeVisible();
    await page.getByLabel('Answer agent question').fill('Review the plan');
    await page.getByRole('button', { name: 'Send answer', exact: true }).click();
    await expect(page.getByLabel('Answer agent question')).toHaveCount(0);
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/workspace.png', fullPage: true });
    await page.reload();
    await expect(page.getByRole('button', { name: 'My unsaved draft', exact: true })).toBeVisible();
  } finally {
    await mcp?.close();
    await host?.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('tasks after the first page stay reachable and totals come from authorized counts', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'tortoise-e2e-'));
  let host: Awaited<ReturnType<typeof startService>> | undefined;
  try {
    host = await startService('@tortoise/field-service', workspace);
    await page.goto(host.launchUrl);
    await page.getByLabel('New work order').fill('Large backlog');
    await page.getByRole('button', { name: 'Create work order', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Large backlog' })).toBeVisible();
    const call = async (kind: 'commands' | 'queries', operation: string, body: object) => {
      const response = await page.request.post(`${host!.origin}/api/v1/${kind}/${operation}`, {
        headers: { Origin: host!.origin },
        data: body,
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const workOrderId = (await call('queries', 'work-order.list', { input: {} })).data.items[0].id;
    // 55 tasks sort by title; the last five, and three done tasks among them, sit on page two.
    for (let index = 1; index <= 55; index++) {
      const { result } = await call('commands', 'task.create', {
        idempotencyKey: `bulk-${index}`,
        input: { workOrderId, title: `Task ${String(index).padStart(2, '0')}` },
      });
      if (index > 52)
        await call('commands', 'task.set-status', {
          idempotencyKey: `done-${index}`,
          input: { id: result.id, status: 'done' },
        });
    }
    await expect(page.getByText('3 of 55 done')).toBeVisible();
    // Each status group pages on its own server count: 52 to do, 3 done.
    const pages = page.getByRole('navigation', { name: 'To do pages' });
    await expect(pages.getByText('1–50 of 52')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Task 52', exact: true })).toHaveCount(0);
    await pages.getByRole('button', { name: 'Next' }).click();
    await expect(pages.getByText('51–52 of 52')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Task 52', exact: true })).toBeVisible();
    await page.getByText('Done · 3').click();
    await expect(page.getByRole('button', { name: 'Task 55', exact: true })).toBeVisible();
  } finally {
    await host?.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
