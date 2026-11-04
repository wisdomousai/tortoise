import { formatDate } from '@/lib/fields';
import { List } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { defineFeatureScreens } from '@tortoise/frame/feature-screens';
import { CapabilityForm } from '@/components/capability-form';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { live } from '@/lib/session';
import { handoverOperations } from './contracts';

const when = (at: number) => formatDate(at);
const words = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** The form to record an entry above the entries, latest first. */
function HandoverScreen() {
  const entries = useQuery(live.liveQueryOptions(handoverOperations.handoverList, {}));
  const items = entries.data?.items ?? [];
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Handover</h1>
      <section aria-label={handoverOperations.handoverRecord.description} className="space-y-3">
        <h2 className="text-base font-medium">New entry</h2>
        <CapabilityForm capability={handoverOperations.handoverRecord} submitLabel="Record" />
      </section>
      <section aria-label="Handover entries" className="space-y-3">
        <h2 className="text-base font-medium">Entries</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No handover entries yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recorded</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead>Text</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{when(entry.recordedAt)}</TableCell>
                  <TableCell>{words(entry.shift)}</TableCell>
                  <TableCell>{entry.recordedBy}</TableCell>
                  <TableCell className="whitespace-normal">{entry.text}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

/** The handover feature's screens, added to `defineScreens({ features })`. */
export const handoverScreens = defineFeatureScreens({
  id: 'handover',
  routes: [{ path: 'handover', component: HandoverScreen }],
  navigation: [{ to: '/handover', label: 'Handover', icon: List }],
  capabilityScreens: [{ prefix: 'handover.', to: '/handover' }],
});
