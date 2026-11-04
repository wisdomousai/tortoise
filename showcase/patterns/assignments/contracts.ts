import { z } from 'zod';
import { defineCapability, defineModule, definePeerApi, jsonSchema } from '@tortoise/contracts';
import { defineAssignmentKind, defineAssignments } from '@tortoise/assignments';
import { requestOperations, testRequestSchema } from '@tortoise/pattern-base/contracts';

/**
 * A sampling round: a field technician goes to a substation, draws an oil sample from each
 * transformer in the instructions and reports its sample number with a description of what to test.
 * Accepting a report submits a test request for that sample.
 */
export const sampling = defineAssignmentKind({
  id: 'sampling',
  title: 'Sampling round',
  description:
    'Draw an oil sample from each transformer in the instructions. Report each sample number with what to test and what you saw at the transformer.',
  scope: z.strictObject({
    substation: z.string().min(1).max(64),
    transformers: z.array(testRequestSchema.shape.transformer).min(1).max(20),
  }),
  instructions: z.strictObject({
    substation: z.string(),
    transformers: z.array(
      z.strictObject({
        transformer: testRequestSchema.shape.transformer,
        /** The transformer's most recent sample in the lab, empty when it has none. */
        lastSample: z.string(),
        lastMethod: z.string(),
      }),
    ),
  }),
  report: z.strictObject({
    sample: testRequestSchema.shape.sample,
    description: z.string().min(1).max(500),
  }),
  accept: z.strictObject({ method: testRequestSchema.shape.method.min(1).optional() }),
  subject: 'transformer',
  assigneeTypes: ['person', 'peer'],
  invokes: [requestOperations.requestSubmit.id],
  changes: ['test-request'],
});

export const assignments = defineAssignments({ kinds: [sampling] });
/** The generated operations, flat, so screens bind them by name. */
export const assignmentOperations = assignments.operations;

export const assigneeSchema = z.strictObject({
  type: z.literal('person'),
  id: z.string().min(1).max(128),
  label: z.string().max(200),
});

export const samplingOperations = {
  assigneeList: defineCapability({
    id: 'sampling.assignee.list',
    kind: 'query',
    description:
      'Who can take a sampling round here: the members of the lab. Peer applications are listed by the peer link.',
    input: jsonSchema(z.strictObject({})),
    output: jsonSchema(z.strictObject({ items: z.array(assigneeSchema) })),
    permission: { action: 'read', resourceType: 'TestRequest' },
    dependencies: ['test-request'],
    ui: { binding: 'sampling.assignee.list' },
  }),
} as const;

/** Who can take sampling rounds. Browser-safe. */
export const samplingModule = defineModule({
  id: 'sampling',
  capabilities: Object.values(samplingOperations),
});

/**
 * What another application may call here over the peer link, as its service principal: the
 * sampling rounds sent to it, its reports on them and its done marks.
 */
export const samplingApi = definePeerApi({
  application: 'test-requests-assignments',
  commands: assignments.assignees.peer.commands,
  queries: assignments.assignees.peer.queries,
});
