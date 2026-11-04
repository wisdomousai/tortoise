import { defineModule } from '@tortoise/contracts';
import { inquiryOperations } from './contracts/inquiry';
import { customerOperations } from './contracts/customer';
import { transformerOperations } from './contracts/transformer';
import { partOperations } from './contracts/part';
import { transformerFind } from './contracts/transformer-find';
import { partSearch } from './contracts/part-search';
import { quoteOperations } from './contracts/quote';
import { quoteDiscount } from './contracts/quote-discount';
import { quoteSubmit } from './contracts/quote-submit';
import { quoteCancel } from './contracts/quote-cancel';
import { assistantAgent } from './contracts/assistant-agent';
import { memberCurrent } from './contracts/member-current';
// scaffold:imports

/** Every operation of the Parts Desk module, by key. Browser-safe. */
export const operations = {
  ...inquiryOperations,
  ...customerOperations,
  ...transformerOperations,
  ...partOperations,
  transformerFind,
  partSearch,
  ...quoteOperations,
  quoteDiscount,
  quoteSubmit,
  quoteCancel,
  memberCurrent,
  // scaffold:operations
} as const;

export const partsDeskModule = defineModule({
  id: 'parts-desk',
  capabilities: Object.values(operations),
  requires: [
    'approval',
    // scaffold:requires
  ],
  agents: [
    assistantAgent,
    // scaffold:agents
  ],
  requirements: {
    network: [
      // scaffold:network
    ],
  },
});
