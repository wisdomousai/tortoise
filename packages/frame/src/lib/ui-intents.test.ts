import { expect, test } from 'bun:test';
import { applyUiIntent, type UiReview } from './ui-intents';

function recorder(select?: (resource: string) => Promise<void>) {
  const calls: string[] = [];
  const reviews: UiReview[] = [];
  return {
    calls,
    reviews,
    handlers: {
      open: async (resource: string) => void calls.push(`open ${resource}`),
      ...(select ? { select } : {}),
      review: (review: UiReview) => void reviews.push(review),
    },
  };
}

test('openResource opens the resource screen and selectResource stays on the current screen', async () => {
  const selected: string[] = [];
  const { calls, handlers } = recorder(async (resource) => void selected.push(resource));
  expect(await applyUiIntent('1', { type: 'openResource', resource: 'note:n1' }, handlers)).toBe(
    'accepted',
  );
  expect(await applyUiIntent('2', { type: 'selectResource', resource: 'note:n2' }, handlers)).toBe(
    'accepted',
  );
  expect(calls).toEqual(['open note:n1']);
  expect(selected).toEqual(['note:n2']);
});

test('a selection the screen cannot show, or a screen without selection, rejects the intent', async () => {
  const refusing = recorder(async () => {
    throw new Error('This screen shows notes');
  });
  expect(
    await applyUiIntent('1', { type: 'selectResource', resource: 'task:t1' }, refusing.handlers),
  ).toBe('rejected');
  const plain = recorder();
  expect(
    await applyUiIntent('2', { type: 'selectResource', resource: 'note:n1' }, plain.handlers),
  ).toBe('rejected');
  expect(plain.calls).toEqual([]);
});

test('a review is shown with its resources and left for the person to complete', async () => {
  const { reviews, handlers } = recorder();
  expect(
    await applyUiIntent(
      '7',
      {
        type: 'requestReview',
        title: 'Suggested title',
        operations: ['note.update'],
        resources: ['approval-request:a1'],
      },
      handlers,
    ),
  ).toBeUndefined();
  expect(reviews).toEqual([
    {
      id: '7',
      title: 'Suggested title',
      operations: ['note.update'],
      resources: ['approval-request:a1'],
    },
  ]);
});
