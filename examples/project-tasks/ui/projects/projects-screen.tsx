import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { operations } from '../../contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { client, live } from '@/lib/session';
import { message } from './shared';

/** `/projects`: opens the first project, or offers to create one. */
export function ProjectsScreen() {
  const navigate = useNavigate();
  const projects = useQuery(
    live.liveQueryOptions(operations.projectList, { archived: false, limit: 1 }),
  );
  const first = projects.data?.items[0];
  useEffect(() => {
    if (first)
      void navigate({ to: '/projects/$projectId', params: { projectId: first.id }, replace: true });
  }, [first, navigate]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  if (!projects.data || first) return <p role="status">Loading projects…</p>;
  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-2xl border border-dashed bg-card p-10 text-center">
      <h1 className="text-2xl font-semibold">Your first project</h1>
      <p className="text-sm text-muted-foreground">
        Name it, then add tasks yourself or let the agent turn a brief into tasks. Your data stays
        on this computer.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void client
            .command(operations.projectCreate, { name })
            .then((receipt) =>
              navigate({ to: '/projects/$projectId', params: { projectId: receipt.result.id } }),
            )
            .catch((cause) => setError(message(cause)));
        }}
      >
        <Label htmlFor="first-project" className="sr-only">
          New project
        </Label>
        <Input
          id="first-project"
          placeholder="Project name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit">Create project</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
