import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { operations } from '../../contracts';
import { live } from '@/lib/session';
import { Pager } from './pager';
import { PAGE, type Project, type Status } from './shared';
import { TaskRow } from './task-row';

/** One status group with its own server-side page; hidden while empty. */
export function TaskGroup({
  project,
  status,
  title,
  collapsed = false,
  onError,
}: {
  project: Project;
  status: Status;
  title: string;
  collapsed?: boolean;
  onError: (message: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const tasks = useQuery(
    live.liveQueryOptions(operations.taskList, {
      projectId: project.id,
      status,
      offset,
      limit: PAGE,
    }),
  );
  const count = tasks.data?.count ?? 0;
  if (!count) return null;
  const body = (
    <>
      <ul className="divide-y">
        {tasks.data?.items.map((task) => (
          <TaskRow key={task.id} task={task} archived={project.archived} onError={onError} />
        ))}
      </ul>
      <Pager label={title} offset={offset} count={count} onChange={setOffset} />
    </>
  );
  const heading = (
    <>
      {title} · <span className="tabular-nums">{count}</span>
    </>
  );
  if (collapsed)
    return (
      <details className="border-t">
        <summary className="cursor-pointer px-6 py-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground">
          {heading}
        </summary>
        {body}
      </details>
    );
  return (
    <div className="border-t">
      <h2 className="px-6 pt-3 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {heading}
      </h2>
      {body}
    </div>
  );
}
