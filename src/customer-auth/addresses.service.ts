import { HttpStatus, Injectable } from '@nestjs/common';
import { CustomerAddress } from '@prisma/client';
import { DomainError } from '../common/problem-details.filter';
import { normalizePhone } from '../common/utils';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto, UpdateAddressDto } from './addresses.dto';

export const MAX_ADDRESSES = 10;

export interface AddressView {
  id: string;
  label: string;
  county: string;
  area: string;
  street: string;
  recipient: string | null;
  phone: string | null;
  isDefault: boolean;
}

const view = (a: CustomerAddress): AddressView => ({
  id: a.id,
  label: a.label,
  county: a.county,
  area: a.area,
  street: a.street,
  recipient: a.recipient,
  phone: a.phone,
  isDefault: a.isDefault,
});

/** A customer's saved delivery places. They keep several and choose one for each order. */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(accountId: string): Promise<AddressView[]> {
    const rows = await this.prisma.customerAddress.findMany({ where: { accountId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    return rows.map(view);
  }

  async create(accountId: string, dto: CreateAddressDto): Promise<AddressView> {
    const phone = this.phone(dto.phone);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.customerAddress.count({ where: { accountId } });
      if (count >= MAX_ADDRESSES) throw new DomainError(HttpStatus.CONFLICT, 'address_limit', `You can save up to ${MAX_ADDRESSES} delivery places. Remove one to add another.`);
      // The first place saved becomes the default.
      const isDefault = count === 0 || !!dto.isDefault;
      if (isDefault) await tx.customerAddress.updateMany({ where: { accountId }, data: { isDefault: false } });
      const row = await tx.customerAddress.create({
        data: { accountId, label: dto.label.trim(), county: dto.county.trim(), area: dto.area.trim(), street: dto.street.trim(), recipient: dto.recipient?.trim() || null, phone, isDefault },
      });
      return view(row);
    });
  }

  async update(accountId: string, id: string, dto: UpdateAddressDto): Promise<AddressView> {
    const phone = dto.phone === undefined ? undefined : this.phone(dto.phone);
    return this.prisma.$transaction(async (tx) => {
      await this.owned(tx, accountId, id);
      if (dto.isDefault) await tx.customerAddress.updateMany({ where: { accountId }, data: { isDefault: false } });
      const row = await tx.customerAddress.update({
        where: { id },
        data: {
          label: dto.label?.trim(),
          county: dto.county?.trim(),
          area: dto.area?.trim(),
          street: dto.street?.trim(),
          recipient: dto.recipient === undefined ? undefined : dto.recipient.trim() || null,
          phone,
          // The default can only be moved by choosing another one, so there is always one while any exist.
          isDefault: dto.isDefault ? true : undefined,
        },
      });
      return view(row);
    });
  }

  async remove(accountId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const gone = await this.owned(tx, accountId, id);
      await tx.customerAddress.delete({ where: { id } });
      if (gone.isDefault) {
        const next = await tx.customerAddress.findFirst({ where: { accountId }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  /** Empty means "none"; anything else must be a valid Kenyan number. */
  private phone(raw?: string): string | null {
    if (!raw?.trim()) return null;
    const p = normalizePhone(raw);
    if (!p) throw new DomainError(HttpStatus.BAD_REQUEST, 'invalid_phone', 'Enter a valid Kenyan phone number.');
    return p;
  }

  private async owned(tx: Pick<PrismaService, 'customerAddress'>, accountId: string, id: string) {
    const row = await tx.customerAddress.findFirst({ where: { id, accountId } });
    if (!row) throw new DomainError(HttpStatus.NOT_FOUND, 'address_not_found', 'Delivery place not found.');
    return row;
  }
}
