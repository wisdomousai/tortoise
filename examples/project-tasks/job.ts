import { createHttpTransport } from '@agent-native/client';
import { readConnection } from '@agent-native/adapters/cli';
import { operations } from './contracts';
import type { OutputOf } from '@agent-native/contracts';

// Explicit demonstration job. Stable revision-bound keys let a retried scheduler
// invocation repeat safely after a lost response. It never opens the database.
const projectId = process.argv[2];
if (!projectId)
  throw new Error('Usage: bun run job <project-id> (moves up to 100 todo tasks to doing)');
const connection = await readConnection();
const transport = createHttpTransport({ baseUrl: connection.endpoint, token: connection.token });
const snapshot = await transport.query<OutputOf<typeof operations.taskList>>(
  operations.taskList.id,
  { projectId, status: 'todo', limit: 100 },
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
