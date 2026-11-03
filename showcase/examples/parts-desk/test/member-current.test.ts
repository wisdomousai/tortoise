import { expect, test } from 'bun:test';
import { owner, stranger, supervisor, testWorkspaces, viewer } from './support';

const open = testWorkspaces('member-current');
const current = { operation: 'member.current', input: {} };

test("member.current returns the caller's own role, and refuses a stranger", async () => {
  const app = await open();
  expect((await app.queryRaw(current, owner)).data).toEqual({ principalId: 'owner', role: 'desk' });
  expect((await app.queryRaw(current, supervisor)).data).toEqual({
    principalId: 'mara',
    role: 'supervisor',
  });
  expect((await app.queryRaw(current, viewer)).data).toEqual({
    principalId: 'viewer',
    role: 'viewer',
  });
  await expect(app.queryRaw(current, stranger)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
