import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Shown when committed data moved past the revision a draft was based on. The draft is never
 * overwritten: the user either rebases onto the latest revision or discards.
 */
export function ConflictBanner({
  onRebase,
  onDiscard,
  message = 'Changed elsewhere. Your draft is preserved.',
}: {
  onRebase: () => void;
  onDiscard: () => void;
  message?: string;
}) {
  return (
    <Alert className="border-warning/50">
      <AlertTitle role="status">{message}</AlertTitle>
      <AlertDescription>Review the latest version before saving your change.</AlertDescription>
      <AlertAction className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onRebase}>
          Use latest revision
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Discard draft
        </Button>
      </AlertAction>
    </Alert>
  );
}
