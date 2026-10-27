import type { AttentionItem } from '@/components/attention-queue';
import type { Attention } from './format';

/**
 * Attention entries as queue items: a held procedure asks whether it took effect (confirming
 * needs a hold); an unsure reading offers "matches" when readable and always "enter the value".
 */
export const toAttentionItems = (attention: readonly Attention[]): AttentionItem[] =>
  attention.map((item) => {
    if (item.kind === 'reconcile')
      return {
        id: item.id,
        kind: 'reconcile',
        title: item.title,
        detail: item.detail,
        choices: [
          { value: 'applied', label: 'Yes, it took effect', tone: 'positive', hold: true },
          { value: 'not-applied', label: 'No, run it again', tone: 'neutral' },
        ],
      };
    const readable = item.proposed !== undefined && item.proposed !== null;
    return {
      id: item.id,
      kind: 'reading',
      title: item.title,
      detail: item.detail,
      proposed: readable ? String(item.proposed) : 'Unreadable',
      confidence: item.confidence,
      source: item.source,
      choices: [
        ...(readable
          ? [{ value: 'confirm', label: 'Matches the machine', tone: 'positive' as const }]
          : []),
        { value: 'correct', label: 'Enter the value', tone: 'neutral' as const },
      ],
    };
  });
