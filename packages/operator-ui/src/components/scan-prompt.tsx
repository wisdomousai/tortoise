import * as React from 'react';
import { CircleAlert, CircleCheck, Keyboard, ScanBarcode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

export interface ScanOutcome {
  /** The decoded value as the operator should see it. */
  readonly value: string;
  readonly ok: boolean;
  /** What the scan was understood as ("Order 4711") or why it was refused. */
  readonly message?: React.ReactNode;
}

/** The last scan in large type, marked accepted or refused by icon, word and color. */
function LastOutcome({ last }: { last: ScanOutcome }) {
  const Outcome = last.ok ? CircleCheck : CircleAlert;
  return (
    <div
      role="status"
      aria-live="assertive"
      data-ok={last.ok}
      className={cn(
        'flex items-center gap-3 rounded-lg border-2 px-4 py-3',
        last.ok ? 'border-op-ok/60 bg-op-ok/10' : 'border-op-fault/60 bg-op-fault/10',
      )}
    >
      <Outcome
        className={cn('size-8 shrink-0', last.ok ? 'text-op-ok' : 'text-op-fault')}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="truncate font-mono text-(length:--operator-text-lg)">{last.value}</p>
        {last.message && <p className="text-(length:--operator-text)">{last.message}</p>}
      </div>
    </div>
  );
}

/** Typed fallback, focused when opened; Escape closes it and keeps what was typed. */
function ManualEntry({
  label,
  inputMode,
  pattern,
  pending,
  value,
  onChange,
  onSubmit,
  onClose,
}: {
  label: string;
  inputMode: 'text' | 'numeric';
  pattern?: string;
  pending: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <form onSubmit={onSubmit}>
      <InputGroup className="h-(--operator-target)">
        <InputGroupInput
          ref={input}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode={inputMode}
          pattern={pattern}
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          className="text-(length:--operator-text)"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="submit"
            variant="default"
            size="sm"
            disabled={pending || !value.trim()}
            className="h-[calc(var(--operator-target)-0.75rem)] px-5 text-(length:--operator-text)"
          >
            Use
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/**
 * Scan-first prompt. The scanner is the normal path: the prompt names what to scan and shows the
 * last outcome in large type. Typing is the fallback for damaged labels and opens on request, so
 * a focused text field never swallows keyboard-wedge scans. Submitted manual values go through
 * the same handler as scans; callers record the input channel.
 */
function ScanPrompt({
  prompt,
  hint,
  last,
  onManual,
  manualLabel = 'Type instead',
  inputMode = 'text',
  pattern,
  pending = false,
  className,
}: {
  prompt: React.ReactNode;
  hint?: React.ReactNode;
  last?: ScanOutcome;
  onManual?: (value: string) => void;
  manualLabel?: string;
  inputMode?: 'text' | 'numeric';
  /** Browser validation for manual entry, e.g. `\\d{8,14}` for GTINs. */
  pattern?: string;
  pending?: boolean;
  className?: string;
}) {
  const [manual, setManual] = React.useState(false);
  const [value, setValue] = React.useState('');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    onManual?.(trimmed);
    setValue('');
    setManual(false);
  };
  return (
    <section
      data-slot="scan-prompt"
      aria-label={typeof prompt === 'string' ? prompt : 'Scan'}
      className={cn(
        'space-y-(--operator-gap) rounded-xl border-2 border-dashed p-(--operator-gap)',
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <ScanBarcode className="size-12 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-(length:--operator-text-lg) font-semibold">{prompt}</p>
          {hint && <p className="text-(length:--operator-text) text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {last && <LastOutcome last={last} />}
      {onManual &&
        (manual ? (
          <ManualEntry
            label={typeof prompt === 'string' ? prompt : 'Code'}
            inputMode={inputMode}
            pattern={pattern}
            pending={pending}
            value={value}
            onChange={setValue}
            onSubmit={submit}
            onClose={() => setManual(false)}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            className="touch-operator h-(--operator-target) w-full text-(length:--operator-text)"
            onClick={() => setManual(true)}
          >
            <Keyboard className="size-7" aria-hidden />
            {manualLabel}
          </Button>
        ))}
    </section>
  );
}

export { ScanPrompt };
