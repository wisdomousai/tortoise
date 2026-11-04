import { createHttpTransport } from '@tortoise/client';
import { readConnection } from '@tortoise/adapters/cli';
import { operations } from './contracts';
import type { OutputOf } from '@tortoise/contracts';

// Start-of-shift job: a scheduler runs it as an ordinary caller to start a work order's tasks.
// Stable revision-bound keys let a retried invocation repeat safely after a lost response. It
// never opens the database.
const workOrderId = process.argv[2];
if (!workOrderId)
  throw new Error('Usage: bun run job <work-order-id> (moves up to 100 todo tasks to doing)');
const connection = await readConnection();
const transport = createHttpTransport({ baseUrl: connection.endpoint, token: connection.token });
const snapshot = await transport.query<OutputOf<typeof operations.taskList>>(
  operations.taskList.id,
  { workOrderId, status: 'todo', limit: 100 },
);
for (const task of snapshot.data.items)
  await transport.command(
    operations.taskSetStatus.id,
    { id: task.id, status: 'doing' },
    {
      idempotencyKey: `job:start:${task.id}:${task.revision}`,
      expectedRevisions: { [`task:${task.id}`]: task.revision },
    },
  );
console.log(JSON.stringify({ updated: snapshot.data.items.length }));
