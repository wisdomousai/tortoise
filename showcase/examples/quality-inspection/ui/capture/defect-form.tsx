import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../../contracts';
import type { CodeGroups, LotDetail } from '../capture-station';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { transport } from '@/lib/session';

type Defects = CodeGroups[number]['codes'];

/** The defect form, bound to `defect.record`; a commit resets it and closes the report. */
function useDefectForm(lot: LotDetail, codeGroups: CodeGroups, onDone: () => void) {
  const defects = codeGroups.find((group) => group.id === 'defects')?.codes ?? [];
  const { form } = useCapabilityForm(transport, operations.defectRecord, {
    defaultValues: { code: defects[0]?.code ?? '', quantity: '1', characteristicId: '', note: '' },
    toInput: (values) => ({
      lotId: lot.id,
      code: values.code,
      quantity: Number(values.quantity),
      ...(values.characteristicId ? { characteristicId: values.characteristicId } : {}),
      ...(values.note.trim() ? { note: values.note.trim() } : {}),
    }),
    onCommitted: () => {
      form.reset();
      onDone();
    },
  });
  return { form, defects };
}

type DefectFormApi = ReturnType<typeof useDefectForm>['form'];

/** Which defect from the published catalog, and how many. */
function DefectCodeFields({ form, defects }: { form: DefectFormApi; defects: Defects }) {
  return (
    <>
      <form.Field name="code">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="defect-code">Defect code</Label>
            <NativeSelect
              id="defect-code"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              {defects.map((code) => (
                <option key={code.code} value={code.code}>
                  {code.code} · {code.text}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </form.Field>
      <form.Field name="quantity">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="defect-quantity">Quantity</Label>
            <Input
              id="defect-quantity"
              inputMode="numeric"
              value={field.state.value}
              aria-invalid={field.state.meta.errors.length > 0}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-xs text-destructive">{field.state.meta.errors.join(', ')}</p>
            )}
          </div>
        )}
      </form.Field>
    </>
  );
}

/** Where the defect is (one characteristic or the whole lot) and an optional note. */
function DefectScopeFields({ form, lot }: { form: DefectFormApi; lot: LotDetail }) {
  return (
    <>
      <form.Field name="characteristicId">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="defect-characteristic">Characteristic</Label>
            <NativeSelect
              id="defect-characteristic"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            >
              <option value="">Whole lot</option>
              {lot.characteristics.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.text}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </form.Field>
      <form.Field name="note">
        {(field) => (
          <div className="space-y-1">
            <Label htmlFor="defect-note">Note</Label>
            <Input
              id="defect-note"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </div>
        )}
      </form.Field>
    </>
  );
}

/** Report a defect for an open lot with a catalog code and quantity. */
export function DefectForm({
  lot,
  codeGroups,
  onDone,
}: {
  lot: LotDetail;
  codeGroups: CodeGroups;
  onDone: () => void;
}) {
  const { form, defects } = useDefectForm(lot, codeGroups, onDone);
  return (
    <form
      aria-label="Report a defect"
      className="grid gap-3 border-t pt-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <DefectCodeFields form={form} defects={defects} />
      <DefectScopeFields form={form} lot={lot} />
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit">Record defect</Button>
        <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
          {(error) =>
            typeof error === 'string' ? (
              <span role="alert" className="text-sm text-destructive">
                {error}
              </span>
            ) : null
          }
        </form.Subscribe>
      </div>
    </form>
  );
}
