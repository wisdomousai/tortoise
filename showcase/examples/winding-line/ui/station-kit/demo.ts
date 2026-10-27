import { useState } from 'react';
import type { AttentionItem } from '@/components/attention-queue';
import type { ScanOutcome } from '@/components/scan-prompt';
import type { ControlHolder } from '@/components/takeover-button';

/** Twelve tiles, so the digit hotkeys and paging both show. */
export const stopReasons = [
  'Material missing',
  'Tool change',
  'Wire break',
  'Quality check',
  'Setup',
  'Cleaning',
  'Operator break',
  'Maintenance',
  'Waiting for crane',
  'Delivery blocked',
  'Downstream full',
  'Unknown',
].map((label, index) => ({
  value: `S${String(index + 1).padStart(2, '0')}`,
  label,
  detail: `S${String(index + 1).padStart(2, '0')}`,
  tone: label === 'Wire break' ? ('negative' as const) : undefined,
}));

/** One unsure reading and one interrupted procedure, the two kinds the queue renders. */
const initialAttention: readonly AttentionItem[] = [
  {
    id: 'reading-1',
    kind: 'reading',
    title: 'Good count read from the screen',
    detail: 'Compare with the counter on the machine.',
    proposed: '1 284',
    confidence: 0.71,
    source: 'Local OCR',
    choices: [
      { value: 'confirm', label: 'Matches', tone: 'positive' },
      { value: 'reject', label: 'Does not match', tone: 'negative' },
    ],
  },
  {
    id: 'reconcile-1',
    kind: 'reconcile',
    title: 'Was recipe R-250 loaded?',
    detail: 'The agent was interrupted before it could confirm the load.',
    choices: [
      { value: 'applied', label: 'Yes, loaded', tone: 'positive', hold: true },
      { value: 'not-applied', label: 'No', tone: 'neutral' },
    ],
  },
];

/**
 * Local state behind the station tab. The gallery screen holds it, not the tab, because the
 * inactive tab unmounts and switching to the scanner tab must not reset the demo.
 */
export function useStationDemo() {
  const [reason, setReason] = useState<string>();
  const [measured, setMeasured] = useState('');
  const [recorded, setRecorded] = useState<number>();
  const [holder, setHolder] = useState<ControlHolder>('agent');
  const [running, setRunning] = useState(true);
  const [scan, setScan] = useState<ScanOutcome>();
  const [attention, setAttention] = useState(initialAttention);
  return {
    reason,
    setReason,
    measured,
    setMeasured,
    recorded,
    setRecorded,
    holder,
    setHolder,
    running,
    setRunning,
    scan,
    setScan,
    attention,
    setAttention,
  };
}

export type StationDemo = ReturnType<typeof useStationDemo>;
