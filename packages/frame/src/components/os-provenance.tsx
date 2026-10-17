import type { OsProvenance } from '@agent-native/contracts';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describeProvenance } from '@/lib/os-deliveries';

/**
 * Where something the OS handed the application came from, shown above the screen it opened or
 * the form it prefilled. A prefilled form shows `prepared`: the values came from outside the
 * application and are committed only when the person submits.
 */
export function OsProvenanceNotice({
  provenance,
  prepared = false,
  onDismiss,
}: {
  provenance: OsProvenance;
  prepared?: boolean;
  onDismiss: () => void;
}) {
  return (
    <Alert>
      <AlertTitle role="status">{describeProvenance(provenance)}</AlertTitle>
      {prepared ? (
        <AlertDescription>Check the prefilled fields before you submit.</AlertDescription>
      ) : null}
      <AlertAction>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {prepared ? 'Discard' : 'Dismiss'}
        </Button>
      </AlertAction>
    </Alert>
  );
}
