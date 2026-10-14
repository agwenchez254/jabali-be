import { Module } from '@nestjs/common';
import { RolesController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({ controllers: [StaffController, RolesController], providers: [StaffService] })
export class StaffModule {}
