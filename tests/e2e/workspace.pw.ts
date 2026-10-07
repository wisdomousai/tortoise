import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('UI, external MCP and deterministic agent share live state; drafts retain their base revision', async ({
  page,
}) => {
  const workspace = await mkdtemp(join(tmpdir(), 'agent-native-e2e-'));
  let child: ChildProcess | undefined;
  let mcp: Client | undefined;
  try {
    const started = new Promise<{ launchUrl: string; connectionFile: string }>(
      (resolveStarted, reject) => {
        child = spawn('bun', ['apps/service/src/index.ts'], {
          cwd: process.cwd(),
          env: { ...process.env, WORKSPACE_PATH: workspace, PORT: '0' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let buffer = '';
        let errors = '';
        child.stderr!.on('data', (data) => {
          errors += data.toString();
        });
        child.stdout!.on('data', (data) => {
          buffer += data.toString();
          const line = buffer.split('\n').find((value) => value.startsWith('{'));
          if (line) {
            try {
              const value = JSON.parse(line);
              if (value.type === 'listening') resolveStarted(value);
            } catch {}
          }
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code) reject(new Error(`Service exited: ${errors}`));
        });
      },
    );
    const host = await started;
    await page.goto(host.launchUrl);
    await page.getByLabel('New project').fill('Launch workspace');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Launch workspace' })).toBeVisible();
    mcp = new Client({ name: 'parity-acceptance', version: '1.0.0' });
    await mcp.connect(
      new StdioClientTransport({
        command: 'bun',
        args: ['packages/adapters/src/mcp.ts'],
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? '', AGENT_NATIVE_CONNECTION: host.connectionFile },
      }),
    );
    const tools = await mcp.listTools();
    expect(tools.tools.length).toBe(12);
    const projects = await mcp.callTool({ name: 'project_list', arguments: { input: {} } });
    const data = projects.structuredContent as { data: { items: { id: string }[] } };
    const projectId = data.data.items[0]!.id;
    const created = await mcp.callTool({
      name: 'task_create',
      arguments: {
        input: { projectId, title: 'Created through MCP' },
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
      .getByLabel('Project brief')
      .fill('Design the workflow\nImplement the capability\nVerify every surface');
    await page.getByRole('button', { name: /Create tasks from brief/ }).click();
    await expect(
      page.getByRole('button', { name: 'Verify every surface', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('succeeded', { exact: true })).toBeVisible();
    const questionRun = await page.request.post(`${new URL(host.launchUrl).origin}/api/v1/runs`, {
      headers: { Origin: new URL(host.launchUrl).origin },
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
    if (child && child.exitCode === null) {
      const stopped = new Promise((resolve) => child!.once('exit', resolve));
      child.kill('SIGTERM');
      await stopped;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});
