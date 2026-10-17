import type { AppNames } from './application';
import type { Generated } from './collection';
import { names, type Names } from './names';

export interface CapabilitySpec {
  /** Dotted operation ID, for example `note.archive`. */
  readonly id: string;
  readonly operationKind: 'command' | 'query';
  /** What the operation does, for whom, and what it changes; agents read it as the tool text. */
  readonly description: string;
}

const OPERATION = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

const contract = (app: AppNames, spec: CapabilitySpec, slug: Names) => `import { z } from 'zod';
import { defineCapability, jsonSchema } from '@agent-native/contracts';

/** ${spec.description} */
export const ${slug.camel} = defineCapability({
  id: '${spec.id}',
  kind: '${spec.operationKind}',
  description: ${JSON.stringify(spec.description)},
  input: jsonSchema(z.strictObject({})),
  output: jsonSchema(z.strictObject({})),
  permission: { action: '${spec.operationKind === 'command' ? 'write' : 'read'}', resourceType: '${app.app.pascal}' },
  ui: { exception: 'headless until a screen binds it' },
});
`;

const handler = (
  spec: CapabilitySpec,
  slug: Names,
) => `import type { HandlerContribution } from '@agent-native/runtime';
import { operations } from '../contracts';
import type { AppState } from '../domain';
import { handler, type Services } from './context';

/** ${spec.description} */
export function ${slug.camel}Handlers(): HandlerContribution<AppState, Services>[] {
  return [handler(operations.${slug.camel}, () => ({}))];
}
`;

/** Editors run a command and viewers are refused; a query is open to every member. */
function behavioralTest(app: AppNames, spec: CapabilitySpec, slug: Names) {
  const command = spec.operationKind === 'command';
  const call = (who: string, key: string) =>
    command
      ? `app.invokeRaw({ operation: '${spec.id}', input: {}, idempotencyKey: '${key}' }, ${who})`
      : `app.queryRaw({ operation: '${spec.id}', input: {} }, ${who})`;
  const viewer = command
    ? `await expect(${call('viewer', 'viewer')}).rejects.toMatchObject({ code: 'FORBIDDEN' });`
    : `await expect(${call('viewer', 'viewer')}).resolves.toBeDefined();`;
  return `import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedAuthority } from '@agent-native/host';
import { create${app.app.pascal}Application } from '../application';

const owner = { workspaceId: 'local', principalId: 'owner' };
const viewer = { workspaceId: 'local', principalId: 'viewer' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

test('${spec.id} is ${command ? 'for editors only' : 'open to members'}', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), '${app.app.kebab}-${slug.kebab}-'));
  const authority = await openEmbeddedAuthority(
    create${app.app.pascal}Application({ members: { viewer: 'viewer' } }),
    { workspacePath },
  );
  cleanup.push(() => rm(workspacePath, { recursive: true, force: true }));
  cleanup.push(() => authority.close());
  const app = authority.application;
  await expect(${call('owner', 'owner')}).resolves.toBeDefined();
  ${viewer}
});
`;
}

/**
 * One headless operation with empty input and output, its handler, its policy rule (editors run
 * a command, members a query) and a behavioral test. It declares a UI exception until a screen
 * binds it; widen its schemas and handler from here.
 */
export function capability(app: AppNames, spec: CapabilitySpec): Generated {
  if (!OPERATION.test(spec.id) || spec.id.length > 64)
    throw new Error(
      `Operation ID must be dotted lowercase words, for example note.archive: ${spec.id}`,
    );
  if (
    !spec.description.trim() ||
    /[\r\n]/.test(spec.description) ||
    spec.description.includes('*/')
  )
    throw new Error('A capability needs a single-line --description without */');
  const slug = names(spec.id.replaceAll('.', '-'), 'Operation ID');
  return {
    files: {
      [`contracts/${slug.kebab}.ts`]: contract(app, spec, slug),
      [`handlers/${slug.kebab}.ts`]: handler(spec, slug),
      [`test/${slug.kebab}.test.ts`]: behavioralTest(app, spec, slug),
    },
    insertions: {
      'contracts.ts': {
        imports: [`import { ${slug.camel} } from './contracts/${slug.kebab}';`],
        operations: [`${slug.camel},`],
      },
      'policy.ts': {
        rules: [
          `[operations.${slug.camel}.id]: ${spec.operationKind === 'command' ? 'editor' : "'open'"},`,
        ],
      },
      'server.ts': {
        imports: [`import { ${slug.camel}Handlers } from './handlers/${slug.kebab}';`],
        handlers: [`...${slug.camel}Handlers(),`],
      },
    },
  };
}
