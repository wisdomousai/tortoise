import { useState } from 'react';
import { operations } from '../../contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { client } from '@/lib/session';
import { message, type Project } from './shared';

/** Who may see and change the project. Membership applies to the UI, tools and delegated runs. */
export function ProjectAccess({
  project,
  onError,
}: {
  project: Project;
  onError: (message: string) => void;
}) {
  const [principalId, setPrincipalId] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer' | 'owner' | 'remove'>('viewer');
  if (!project.members) return null;
  return (
    <section
      aria-label="Project access"
      className="mx-6 mb-4 space-y-3 rounded-xl border bg-muted/40 p-4 text-sm"
    >
      <p className="text-muted-foreground">
        Access applies everywhere: this screen, tools and agents acting for someone.
      </p>
      <ul className="space-y-1.5">
        {Object.entries(project.members).map(([principal, membership]) => (
          <li key={principal} className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase"
            >
              {principal[0]}
            </span>
            <span className="flex-1 font-medium">{principal}</span>
            <span className="text-muted-foreground capitalize">{membership}</span>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void client
            .command(
              operations.projectSetMember,
              { id: project.id, principalId, role: role === 'remove' ? null : role },
              { expectedRevisions: { [`project:${project.id}`]: project.revision } },
            )
            .then(() => setPrincipalId(''))
            .catch((error) => onError(message(error)));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="member">Person</Label>
          <Input
            id="member"
            placeholder="User ID"
            value={principalId}
            onChange={(event) => setPrincipalId(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="member-role">Role</Label>
          <NativeSelect
            id="member-role"
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
            <option value="remove">Remove access</option>
          </NativeSelect>
        </div>
        <Button type="submit">Update access</Button>
      </form>
    </section>
  );
}
