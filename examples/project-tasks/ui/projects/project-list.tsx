import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { operations } from '../../contracts';
import { SidebarLink, SidebarSection } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { client, live } from '@/lib/session';
import { message, PAGE, useProjectId, type Project } from './shared';

/** The sidebar form for a new project. The parent keeps the name across collapsing it. */
function NewProjectForm({
  name,
  onName,
  error,
  onSubmit,
}: {
  name: string;
  onName: (name: string) => void;
  error: string;
  onSubmit: () => void;
}) {
  return (
    <form
      className="mt-1 space-y-1.5 px-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        aria-label="Project name"
        placeholder="Project name"
        required
        autoFocus
        value={name}
        onChange={(event) => onName(event.target.value)}
        className="h-9 border-white/15 bg-sidebar-accent text-sidebar-foreground placeholder:text-sidebar-muted"
      />
      <Button type="submit" size="sm" className="w-full">
        Create project
      </Button>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </form>
  );
}

/**
 * Sidebar section: the person's projects with the open one highlighted, and creating one. The
 * list is server-paginated; archived projects are counted and listed separately.
 */
export function ProjectList() {
  const navigate = useNavigate();
  const current = useProjectId();
  const active = useQuery(
    live.liveQueryOptions(operations.projectList, { archived: false, limit: PAGE }),
  );
  const archived = useQuery(
    live.liveQueryOptions(operations.projectList, { archived: true, limit: PAGE }),
  );
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const create = async () => {
    setError('');
    try {
      const receipt = await client.command(operations.projectCreate, { name });
      setName('');
      setCreating(false);
      void navigate({ to: '/projects/$projectId', params: { projectId: receipt.result.id } });
    } catch (cause) {
      setError(message(cause));
    }
  };
  const link = (project: Project) => (
    <SidebarLink
      key={project.id}
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      active={project.id === current}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
    </SidebarLink>
  );
  return (
    <SidebarSection
      title="Projects"
      action={
        <button
          type="button"
          aria-label="Add a project"
          aria-expanded={creating}
          onClick={() => setCreating((value) => !value)}
          className="rounded p-0.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      }
    >
      {active.data?.items.map(link)}
      {active.data && active.data.count > active.data.items.length && (
        <p className="px-3 py-1 text-xs text-sidebar-muted">
          {active.data.count - active.data.items.length} more; find them with ⌘K
        </p>
      )}
      {creating && (
        <NewProjectForm name={name} onName={setName} error={error} onSubmit={() => void create()} />
      )}
      {archived.data && archived.data.count > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer px-3 py-1.5 text-sm text-sidebar-muted hover:text-sidebar-foreground">
            Archived ({archived.data.count})
          </summary>
          {archived.data.items.map(link)}
        </details>
      )}
    </SidebarSection>
  );
}
