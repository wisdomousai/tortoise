import type { ComponentType } from 'react';
import { NotebookPen } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { noteOperations } from '../contracts';

/** A panel an application adds below one note, such as publishing or a suggested title. */
export type NoteSection = ComponentType<{ id: string }>;

function NoteScreen({ sections }: { sections: readonly NoteSection[] }) {
  const { id } = useParams({ strict: false }) as { id: string };
  return (
    <div className="space-y-8">
      <RecordScreen title="Note" get={noteOperations.noteGet} update={noteOperations.noteUpdate} />
      {sections.map((Section, index) => (
        <Section key={index} id={id} />
      ))}
    </div>
  );
}

/**
 * The note list and the note screen. An application that composes the notes module spreads
 * these into its own screens and passes `sections` to add panels to the note screen.
 */
export function noteRoutes(options: { sections?: readonly NoteSection[] } = {}) {
  const sections = options.sections ?? [];
  return [
    {
      path: 'notes',
      component: () => (
        <CollectionScreen
          title="Notes"
          list={noteOperations.noteList}
          create={noteOperations.noteAdd}
          columns={['title', 'author']}
          open={(row) => `/notes/${String(row.id)}`}
        />
      ),
    },
    { path: 'notes/$id', component: () => <NoteScreen sections={sections} /> },
  ];
}

export const noteNavigation = [{ to: '/notes', label: 'Notes', icon: NotebookPen }];
export const noteCapabilityScreens = [{ prefix: 'note.', to: '/notes' }];
