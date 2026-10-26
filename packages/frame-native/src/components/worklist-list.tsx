import { FlatList, Text } from 'react-native';
import { ListRow } from './list-row';
import { StatusPill } from './status-pill';

/** An assignment as a worklist's `assignment.list` returns it. */
export interface WorklistItem {
  id: string;
  kind: string;
  title: string;
  open: boolean;
  done: boolean;
  doneSync?: 'pending' | 'accepted' | 'rejected';
  reports: number;
  rejection?: { code: string; message: string };
}

/** Where an assignment stands here: open, done and waiting, done, done refused, or closed. */
function Standing({ item, issuer }: { item: WorklistItem; issuer: string }) {
  if (item.done)
    return item.doneSync === 'accepted' ? (
      <StatusPill signal="ok" label="Done" />
    ) : (
      <StatusPill signal="pending" label={`Done, waiting for ${issuer}`} />
    );
  if (item.doneSync === 'rejected') return <StatusPill signal="fault" label="Done refused" />;
  if (item.open) return null;
  return <StatusPill signal="idle" label={`Closed by ${issuer}`} />;
}

/**
 * A worklist's assignments, open ones first, each a glove-sized row with its report count and
 * where it stands. A refused done mark reopens the assignment and its reason shows as the detail.
 * The screen reads the worklist's `assignment.list` and passes its items, so it binds the query.
 */
export function WorklistList({
  items,
  onOpen,
  detail = (item) => `${item.reports} reports`,
  issuer = 'the issuer',
  empty = 'No assignments yet.',
}: {
  items: readonly WorklistItem[];
  onOpen?: (item: WorklistItem) => void;
  detail?: (item: WorklistItem) => string;
  /** Who sends the work, for the waiting label, for example "the hub". */
  issuer?: string;
  empty?: string;
}) {
  const sorted = [...items].sort((a, b) => Number(b.open) - Number(a.open));
  return (
    <FlatList
      data={sorted}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ListRow
          title={item.title}
          detail={
            item.rejection ? `${item.rejection.code}: ${item.rejection.message}` : detail(item)
          }
          trailing={<Standing item={item} issuer={issuer} />}
          {...(onOpen ? { onPress: () => onOpen(item) } : {})}
        />
      )}
      ListEmptyComponent={<Text className="text-operator text-muted-foreground">{empty}</Text>}
    />
  );
}
