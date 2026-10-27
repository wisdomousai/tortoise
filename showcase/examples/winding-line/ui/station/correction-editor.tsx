import { NumericPad } from '@/components/numeric-pad';
import { TilePicker } from '@/components/tile-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Attention } from './format';

/**
 * Enter the value shown on the machine in the form the profile declares for the field: a keypad
 * for numbers, tiles for options and yes/no, a text field for text. A blank entry is never sent.
 */
export function CorrectionEditor({
  item,
  draft,
  onDraft,
  pending,
  onSubmit,
}: {
  item: Attention;
  draft: string;
  onDraft: (value: string) => void;
  pending: boolean;
  onSubmit: (value: string | number | boolean) => void;
}) {
  const label = `${item.title}: value on the machine`;
  const declared = item.value ?? { type: 'text' as const };
  if (declared.type === 'number')
    return (
      <NumericPad
        label={label}
        value={draft}
        onChange={onDraft}
        onSubmit={onSubmit}
        pending={pending}
        unit={declared.unit}
        decimals={declared.decimals ?? 0}
      />
    );
  if (declared.type === 'enum' || declared.type === 'boolean')
    return (
      <TilePicker
        label={label}
        pending={pending}
        tiles={
          declared.type === 'boolean'
            ? [
                { value: 'true', label: 'Yes' },
                { value: 'false', label: 'No' },
              ]
            : (declared.options ?? []).map((option) => ({ value: option, label: option }))
        }
        onPick={(value) => onSubmit(declared.type === 'boolean' ? value === 'true' : value)}
      />
    );
  return (
    <form
      className="flex gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim()) onSubmit(draft.trim());
      }}
    >
      <Input
        aria-label={label}
        className="h-14 text-(length:--operator-text)"
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        autoFocus
      />
      <Button type="submit" size="lg" disabled={pending || !draft.trim()}>
        Confirm
      </Button>
    </form>
  );
}
