import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PERMISSIONS } from '../src/common/permissions';
import { bootApp, json } from './helpers/app';
import { staffAuth } from './helpers/shop';

jest.setTimeout(90_000);

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  staffCount?: number;
}

describe('roles', () => {
  let app: NestFastifyApplication;
  let base: string;
  let owner: Record<string, string>;

  beforeAll(async () => {
    ({ app, base } = await bootApp({ RATE_LIMIT_ENABLED: 'false' }));
    owner = await staffAuth(base);
  });
  afterAll(async () => {
    await app.close();
  });

  const roles = async () => (await (await fetch(`${base}/admin/roles`, { headers: owner })).json()) as Role[];
  const createRole = (body: unknown, auth = owner) => fetch(`${base}/admin/roles`, json(body, auth));
  const patchRole = (id: string, body: unknown, auth = owner) => fetch(`${base}/admin/roles/${id}`, json(body, auth, 'PATCH'));
  const deleteRole = (id: string, auth = owner) => fetch(`${base}/admin/roles/${id}`, { method: 'DELETE', headers: auth });

  it('lists every permission the server knows, for the toggles', async () => {
    const r = await fetch(`${base}/admin/roles/permissions`, { headers: owner });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { permissions: string[] }).permissions).toEqual([...PERMISSIONS]);
  });

  it('creates a role with permissions, changes them and deletes it', async () => {
    const created = await createRole({ name: 'e2e_support', description: 'Answers customers', permissions: ['order:read', 'customer:read'] });
    expect(created.status).toBe(201);
    const role = (await created.json()) as Role;
    expect(role).toMatchObject({ name: 'e2e_support', description: 'Answers customers', permissions: ['customer:read', 'order:read'] });

    const updated = await patchRole(role.id, { permissions: ['order:read', 'order:write', 'blog:read'], description: 'Orders and blog' });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ description: 'Orders and blog', permissions: ['blog:read', 'order:read', 'order:write'] });
    expect((await roles()).find((r) => r.id === role.id)).toMatchObject({ staffCount: 0, permissions: ['blog:read', 'order:read', 'order:write'] });

    expect((await deleteRole(role.id)).status).toBe(204);
    expect((await roles()).some((r) => r.id === role.id)).toBe(false);
  });

  it('refuses a role name that is taken, a name that is too short and a permission that does not exist', async () => {
    const first = (await (await createRole({ name: 'e2e_dupe', permissions: [] })).json()) as Role;
    expect((await createRole({ name: 'e2e_dupe', permissions: [] })).status).toBe(409);
    expect((await createRole({ name: 'x', permissions: [] })).status).toBe(400);
    expect((await createRole({ name: 'e2e_bad_perm', permissions: ['order:fly'] })).status).toBe(400);
    expect((await patchRole(first.id, { permissions: ['nope:read'] })).status).toBe(400);
    await deleteRole(first.id);
  });

  it('cannot delete a role while people still have it, and can once they are moved', async () => {
    const role = (await (await createRole({ name: 'e2e_busy', permissions: ['order:read'] })).json()) as Role;
    const spare = (await (await createRole({ name: 'e2e_spare', permissions: ['order:read'] })).json()) as Role;
    const hired = await fetch(`${base}/admin/staff`, json({ name: 'Role Tester', email: 'role.tester@jabali.test', password: 'Tester-Password-123!', roleId: role.id }, owner));
    expect(hired.status).toBe(201);
    const member = (await hired.json()) as { id: string };

    const blocked = await deleteRole(role.id);
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { detail?: string }).detail).toMatch(/still assigned/i);
    expect((await roles()).find((r) => r.id === role.id)?.staffCount).toBe(1);

    expect((await fetch(`${base}/admin/staff/${member.id}`, json({ roleId: spare.id }, owner, 'PATCH'))).status).toBe(200);
    expect((await deleteRole(role.id)).status).toBe(204);
    expect((await deleteRole(spare.id)).status).toBe(409); // the person moved onto it
    await fetch(`${base}/admin/staff/${member.id}`, json({ status: 'disabled' }, owner, 'PATCH'));
  });

  it('keeps the owner role fixed', async () => {
    const owners = (await roles()).find((r) => r.name === 'owner') as Role;
    expect((await patchRole(owners.id, { permissions: ['order:read'] })).status).toBe(400);
    expect((await deleteRole(owners.id)).status).toBe(400);
  });

  it('lets only staff with staff:write change roles', async () => {
    const viewer = (await roles()).find((r) => r.name === 'viewer') as Role;
    const target = (await (await createRole({ name: 'e2e_guarded', permissions: [] })).json()) as Role;
    const hired = await fetch(`${base}/admin/staff`, json({ name: 'View Only', email: 'view.only@jabali.test', password: 'Viewer-Password-123!', roleId: viewer.id }, owner));
    expect(hired.status).toBe(201);
    const login = await fetch(`${base}/admin/auth/login`, json({ email: 'view.only@jabali.test', password: 'Viewer-Password-123!' }));
    const { accessToken } = (await login.json()) as { accessToken: string };
    const auth = { authorization: `Bearer ${accessToken}` };
    expect((await createRole({ name: 'e2e_nope', permissions: [] }, auth)).status).toBe(403);
    expect((await patchRole(target.id, { description: 'x' }, auth)).status).toBe(403);
    expect((await deleteRole(target.id, auth)).status).toBe(403);
    expect((await fetch(`${base}/admin/roles`, { headers: auth })).status).toBe(403); // viewer has no staff:read either
    await deleteRole(target.id);
  });
});
