import { Body, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../common/auth/auth.types';
import { AdminController, CurrentUser, RequirePermissions } from '../common/auth/decorators';
import { CreateRoleDto, CreateStaffDto, UpdateRoleDto, UpdateStaffDto } from './staff.dto';
import { StaffService } from './staff.service';

@AdminController('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get() @RequirePermissions('staff:read')
  list() {
    return this.staff.listStaff();
  }

  @Post() @RequirePermissions('staff:write')
  create(@Body() dto: CreateStaffDto) {
    return this.staff.createStaff(dto);
  }

  @Patch(':id') @RequirePermissions('staff:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStaffDto, @CurrentUser() me: AuthUser) {
    return this.staff.updateStaff(id, dto, me.id);
  }
}

@AdminController('roles')
export class RolesController {
  constructor(private readonly staff: StaffService) {}

  @Get() @RequirePermissions('staff:read')
  list() {
    return this.staff.listRoles();
  }

  @Get('permissions') @RequirePermissions('staff:read')
  permissions() {
    return { permissions: this.staff.permissionCatalogue() };
  }

  @Post() @RequirePermissions('staff:write')
  create(@Body() dto: CreateRoleDto) {
    return this.staff.createRole(dto);
  }

  @Patch(':id') @RequirePermissions('staff:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.staff.updateRole(id, dto);
  }

  @Delete(':id') @HttpCode(204) @RequirePermissions('staff:write')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.staff.deleteRole(id);
  }
}
