import { Get, Module, Query } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AdminController, RequirePermissions } from '../common/auth/decorators';
import { PageQueryDto, pageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

class AuditQuery extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(60) entity?: string;
  @IsOptional() @IsString() @MaxLength(100) entityId?: string;
  @IsOptional() @IsUUID() actorId?: string;
}

@AdminController('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Audit trail of admin writes, newest first. */
  @Get() @RequirePermissions('audit:read')
  async list(@Query() q: AuditQuery) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = { entity: q.entity, entityId: q.entityId, actorId: q.actorId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, skip, take, orderBy: { at: 'desc' } }),
    ]);
    const actors = await this.prisma.staffUser.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return toPage(rows.map((r) => ({ ...r, actor: r.actorId ? (byId.get(r.actorId) ?? null) : null })), total, page, pageSize);
  }
}

@Module({ controllers: [AuditController] })
export class AuditModule {}
