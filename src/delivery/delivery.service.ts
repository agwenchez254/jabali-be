import { ConflictException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryZone } from '@prisma/client';
import { CacheService } from '../common/cache/cache.service';
import { DomainError } from '../common/problem-details.filter';
import { Db, PrismaService } from '../prisma/prisma.service';
import { CreateZoneDto, UpdateZoneDto } from './delivery.dto';

export interface DeliveryQuote {
  county: string;
  zone: { id: string; code: string; name: string; eta: string; etaDays: number };
  fee: number;
  freeOver: number | null;
  free: boolean;
  /** KES still needed to reach free delivery (null when there is no threshold). */
  amountToFree: number | null;
}

/** Case/whitespace-insensitive county comparison key. */
const key = (s: string) => s.trim().toLowerCase();

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  listZones(onlyActive = false) {
    return this.prisma.deliveryZone.findMany({
      where: onlyActive ? { active: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { fee: 'asc' }],
    });
  }

  storeZones() {
    return this.cache.wrap('store:delivery:zones', 300, () => this.listZones(true));
  }

  async createZone(dto: CreateZoneDto) {
    await this.assertCountiesFree(dto.counties);
    return this.prisma.deliveryZone.create({
      data: { ...dto, freeOver: dto.freeOver ?? null, etaDays: dto.etaDays ?? 2, eta: dto.eta ?? '' },
    });
  }

  async updateZone(id: string, dto: UpdateZoneDto) {
    if (dto.counties) await this.assertCountiesFree(dto.counties, id);
    return this.prisma.deliveryZone.update({ where: { id }, data: dto });
  }

  async deleteZone(id: string): Promise<void> {
    const res = await this.prisma.deliveryZone.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException('Zone not found');
  }

  private async assertCountiesFree(counties: string[], exceptId?: string): Promise<void> {
    const others = await this.prisma.deliveryZone.findMany({ where: exceptId ? { id: { not: exceptId } } : undefined });
    const taken = new Set(others.flatMap((z) => z.counties.map(key)));
    const clash = counties.filter((c) => taken.has(key(c)));
    if (clash.length) throw new ConflictException(`Counties already assigned to another zone: ${clash.join(', ')}`);
  }

  async findZone(county: string, db: Db = this.prisma): Promise<DeliveryZone | null> {
    const zones = await db.deliveryZone.findMany({ where: { active: true } });
    return zones.find((z) => z.counties.some((c) => key(c) === key(county))) ?? null;
  }

  /** Global free-delivery threshold from site settings (zone.freeOver wins when set). */
  async globalFreeOver(db: Db = this.prisma): Promise<number | null> {
    const row = await db.siteSetting.findUnique({ where: { key: 'freeDeliveryThreshold' } });
    return typeof row?.value === 'number' ? row.value : null;
  }

  /** Delivery terms for a county; `subtotal` is the order amount after discounts. */
  async terms(county: string, db: Db = this.prisma): Promise<{ zone: DeliveryZone; fee: number; freeOver: number | null }> {
    const zone = await this.findZone(county, db);
    if (!zone) {
      throw new DomainError(HttpStatus.UNPROCESSABLE_ENTITY, 'county_not_served', `We do not deliver to "${county}" yet`);
    }
    return { zone, fee: zone.fee, freeOver: zone.freeOver ?? (await this.globalFreeOver(db)) };
  }

  async quote(county: string, subtotal = 0): Promise<DeliveryQuote> {
    const { zone, fee, freeOver } = await this.terms(county);
    const free = freeOver !== null && subtotal >= freeOver;
    return {
      county,
      zone: { id: zone.id, code: zone.code, name: zone.name, eta: zone.eta, etaDays: zone.etaDays },
      fee: free ? 0 : fee,
      freeOver,
      free,
      amountToFree: freeOver === null ? null : Math.max(0, freeOver - subtotal),
    };
  }
}
