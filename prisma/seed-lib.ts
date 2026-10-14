import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ROLE_DEFINITIONS } from '../src/common/permissions';

import { ARGON_OPTS } from '../src/common/password';

/** Upserts the five default roles with their permission sets and the owner staff account. */
export async function seedAccess(
  prisma: PrismaClient,
  owner: { email: string; password: string; name: string },
): Promise<void> {
  for (const [name, def] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { description: def.description },
      create: { name, description: def.description },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: def.permissions.map((permission) => ({ roleId: role.id, permission })),
    });
  }
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'owner' } });
  const existing = await prisma.staffUser.findUnique({ where: { email: owner.email } });
  if (!existing) {
    await prisma.staffUser.create({
      data: {
        email: owner.email,
        name: owner.name,
        roleId: ownerRole.id,
        passwordHash: await argon2.hash(owner.password, ARGON_OPTS),
      },
    });
  }
}
