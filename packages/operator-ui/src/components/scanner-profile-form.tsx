import * as React from 'react';
import { keyboardLayouts, scannerTransports, type ScannerProfile } from '@agent-native/devices';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-2">
      <p className="font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            variant={value === option ? 'default' : 'outline'}
            className="touch-operator h-(--operator-target) min-w-(--operator-target) px-4 text-(length:--operator-text)"
            onClick={() => onChange(option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & { id: string; label: string; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-(length:--operator-text)">
        {label}
      </Label>
      <Input
        id={id}
        className="h-(--operator-target) text-(length:--operator-text) md:text-(length:--operator-text)"
        {...props}
      />
      {hint && <p className="text-[0.8em] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const textOrUndefined = (value: string) => (value === '' ? undefined : value);

/** Step 2: every profile setting as a touch-sized control, with the schema's issues below. */
function ProfileCard({
  draft,
  update,
  issues,
}: {
  draft: ScannerProfile;
  update: (patch: Partial<ScannerProfile>) => void;
  /** Validation messages; empty when the draft is a valid profile. */
  issues: readonly string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-(length:--operator-text-lg)">2 · Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-(--operator-gap) text-(length:--operator-text)">
        <Field
          id="scanner-label"
          label="Name"
          value={draft.label}
          onChange={(event) => update({ label: event.target.value })}
        />
        <Choice
          label="Connection"
          value={draft.transport}
          options={scannerTransports}
          onChange={(transport) => update({ transport })}
        />
        <Choice
          label="Ends with"
          value={draft.terminator}
          options={['Enter', 'Tab', 'none'] as const}
          onChange={(terminator) => update({ terminator })}
        />
        <Choice
          label="Scanner keyboard layout"
          value={draft.scannerLayout}
          options={keyboardLayouts}
          onChange={(scannerLayout) => update({ scannerLayout })}
        />
        <div className="grid gap-(--operator-gap) sm:grid-cols-3">
          <Field
            id="scanner-prefix"
            label="Prefix"
            value={draft.prefix ?? ''}
            onChange={(event) => update({ prefix: textOrUndefined(event.target.value) })}
          />
          <Field
            id="scanner-suffix"
            label="Suffix"
            value={draft.suffix ?? ''}
            onChange={(event) => update({ suffix: textOrUndefined(event.target.value) })}
          />
          <Field
            id="scanner-gap"
            label="Key gap (ms)"
            inputMode="numeric"
            value={String(draft.maxGapMs)}
            onChange={(event) => update({ maxGapMs: Number(event.target.value) || 0 })}
          />
        </div>
        <Choice
          label="AIM symbology identifiers"
          value={draft.aimIds ? 'on' : 'off'}
          options={['on', 'off'] as const}
          onChange={(value) => update({ aimIds: value === 'on' })}
        />
        {issues.length > 0 && (
          <p role="alert" className="text-op-fault">
            {issues.join(' · ')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export { ProfileCard };
