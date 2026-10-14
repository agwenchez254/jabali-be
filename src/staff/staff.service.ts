import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ARGON_OPTS } from '../common/password';
import { PERMISSIONS } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto, CreateStaffDto, UpdateRoleDto, UpdateStaffDto } from './staff.dto';

const PROTECTED_ROLE = 'owner';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  private publicStaff = {
    id: true,
    name: true,
    email: true,
    status: true,
    lastLoginAt: true,
    createdAt: true,
    role: { select: { id: true, name: true } },
  } as const;

  listStaff() {
    return this.prisma.staffUser.findMany({ select: this.publicStaff, orderBy: { createdAt: 'asc' } });
  }

  async createStaff(dto: CreateStaffDto) {
    await this.assertRole(dto.roleId);
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.staffUser.findUnique({ where: { email } })) {
      throw new ConflictException('A staff member with this email already exists');
    }
    return this.prisma.staffUser.create({
      data: { name: dto.name, email, roleId: dto.roleId, passwordHash: await argon2.hash(dto.password, ARGON_OPTS) },
      select: this.publicStaff,
    });
  }

  async updateStaff(id: string, dto: UpdateStaffDto, actorId: string) {
    const target = await this.prisma.staffUser.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw new NotFoundException('Staff member not found');
    if (id === actorId && (dto.status === 'disabled' || (dto.roleId && dto.roleId !== target.roleId))) {
      throw new BadRequestException('You cannot disable or re-role your own account');
    }
    if (dto.roleId) await this.assertRole(dto.roleId);
    // never leave the shop without an active owner
    const losesOwner = target.role.name === PROTECTED_ROLE && (dto.status === 'disabled' || (dto.roleId && dto.roleId !== target.roleId));
    if (losesOwner) {
      const owners = await this.prisma.staffUser.count({ where: { status: 'active', role: { name: PROTECTED_ROLE } } });
      if (owners <= 1) throw new BadRequestException('At least one active owner is required');
    }
    const updated = await this.prisma.staffUser.update({
      where: { id },
      data: {
        name: dto.name,
        roleId: dto.roleId,
        status: dto.status,
        passwordHash: dto.password ? await argon2.hash(dto.password, ARGON_OPTS) : undefined,
        failedLogins: dto.password ? 0 : undefined,
        lockedUntil: dto.password ? null : undefined,
      },
      select: this.publicStaff,
    });
    if (dto.password || dto.status === 'disabled' || dto.roleId) {
      await this.prisma.refreshToken.updateMany({ where: { staffId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return updated;
  }

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      include: { permissions: true, _count: { select: { staff: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      staffCount: r._count.staff,
      permissions: r.permissions.map((p) => p.permission).sort(),
    }));
  }

  permissionCatalogue(): string[] {
    return [...PERMISSIONS];
  }

  async createRole(dto: CreateRoleDto) {
    if (await this.prisma.role.findUnique({ where: { name: dto.name } })) throw new ConflictException('Role name already exists');
    const role = await this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description ?? '',
        permissions: { create: [...new Set(dto.permissions)].map((permission) => ({ permission })) },
      },
    });
    return this.getRole(role.id);
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === PROTECTED_ROLE) throw new BadRequestException('The owner role cannot be modified');
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { name: dto.name, description: dto.description } });
      if (dto.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: [...new Set(dto.permissions)].map((permission) => ({ roleId: id, permission })) });
      }
    });
    return this.getRole(id);
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { staff: true } } } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === PROTECTED_ROLE) throw new BadRequestException('The owner role cannot be deleted');
    if (role._count.staff > 0) throw new ConflictException('Role is still assigned to staff members');
    await this.prisma.role.delete({ where: { id } });
  }

  private async getRole(id: string) {
    const r = await this.prisma.role.findUniqueOrThrow({ where: { id }, include: { permissions: true } });
    return { id: r.id, name: r.name, description: r.description, permissions: r.permissions.map((p) => p.permission).sort() };
  }

  private async assertRole(roleId: string): Promise<void> {
    if (!(await this.prisma.role.findUnique({ where: { id: roleId } }))) throw new BadRequestException('Unknown roleId');
  }
}
