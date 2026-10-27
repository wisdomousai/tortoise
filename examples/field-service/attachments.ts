import type { BlobLimits } from '@agent-native/contracts';

/** Files a task may carry: PNG and JPEG images and PDFs of at most 10 MiB. */
export const attachmentLimits: BlobLimits = {
  maxBytes: 10 * 1024 * 1024,
  mediaTypes: ['image/png', 'image/jpeg', 'application/pdf'],
};
