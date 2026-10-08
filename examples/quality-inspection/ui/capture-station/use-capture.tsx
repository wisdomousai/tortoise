import { useMemo, useRef, useState } from 'react';
import { useCaptureLoop, useScannerInput } from '@agent-native/react/capture';
import { useCapabilityForm } from '@agent-native/react/form';
import { operations } from '../../contracts';
import { transport } from '@/lib/session';
import type { CodeGroups, LotDetail, Target } from './format';

/**
 * The sample being measured and the form that records it. The worklist names the next sample;
 * picking one overrides it, and typing pins the slot so live updates cannot move a draft to a
 * different sample. Every commit carries its time from "ready" and the input that produced it.
 */
export function useCapture(lot: LotDetail, codeGroups: CodeGroups) {
  const [override, setOverride] = useState<Target>();
  // The slot a draft belongs to, pinned when typing starts. Live updates may advance the worklist
  // while the operator types; the value still describes the sample they were measuring.
  const [pinned, setPinned] = useState<Target>();
  const [announcement, setAnnouncement] = useState('');
  const target = override ?? pinned ?? lot.next ?? undefined;
  const characteristic = lot.characteristics.find((item) => item.id === target?.characteristicId);
  // Another caller recorded the draft's sample first: the draft is not silently moved elsewhere.
  const taken = characteristic?.results.find((result) => result.sample === target?.sample);
  const codes = useMemo(
    () => codeGroups.find((group) => group.id === characteristic?.codeGroup)?.codes ?? [],
    [codeGroups, characteristic?.codeGroup],
  );
  const valueField = useRef<HTMLInputElement>(null);
  const itemKey = target ? `${target.characteristicId}:${target.sample}` : undefined;
  const { elapsed } = useCaptureLoop(itemKey, valueField);
  const scanner = useScannerInput({});

  const { form } = useCapabilityForm(transport, operations.resultRecord, {
    defaultValues: { value: '', code: '' },
    toInput: (values) => {
      if (!target || !characteristic) throw new Error('Nothing left to measure on this lot');
      if (taken) throw new Error(`Sample ${target.sample} is already recorded`);
      const quantitative = characteristic.kind === 'quantitative';
      if (quantitative && values.value.trim() === '') throw new Error('Enter a measured value');
      const durationMs = elapsed();
      return {
        lotId: lot.id,
        characteristicId: target.characteristicId,
        sample: target.sample,
        ...(quantitative
          ? { value: Number(values.value.replace(',', '.')) }
          : { code: values.code }),
        // The measurement happened when the operator confirmed it, not when the server commits.
        occurredAt: Date.now(),
        station: 'web',
        ...(durationMs === undefined ? {} : { capture: { durationMs, input: scanner.lastInput } }),
      };
    },
    onCommitted: (receipt) => {
      const result = receipt.result;
      setAnnouncement(
        `Recorded ${result.value ?? result.code} for ${characteristic?.code} sample ${result.sample}: ${
          result.evaluation === 'accepted' ? 'in tolerance' : 'out of tolerance'
        }`,
      );
      setOverride(undefined);
      setPinned(undefined);
      form.reset();
    },
  });
  const discard = () => {
    setOverride(undefined);
    setPinned(undefined);
    form.reset();
  };

  const submitCode = (code: string) => {
    form.setFieldValue('code', code);
    scanner.markTouch();
    void form.handleSubmit();
  };
  return {
    target,
    characteristic,
    taken,
    codes,
    override,
    setOverride,
    setPinned,
    announcement,
    valueField,
    form,
    discard,
    submitCode,
  };
}

export type CaptureForm = ReturnType<typeof useCapture>['form'];
