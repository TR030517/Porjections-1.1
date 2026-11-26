/**
 * MJAPP — AuditLog Controller
 *
 * Admin-only endpoints for querying audit logs.
 * Protected by AuthGuard('jwt') + RolesGuard with @Roles('ADMIN').
 */

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto, AuditLogTargetParamsDto, AuditLogTargetQueryDto } from './dto/audit-log-query.dto';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Admin — Audit Log')
@Controller('admin/audit-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Read audit metadata and safe summaries with UTC filters' })
  findAll(@Query() query: AuditLogQueryDto) {
    return this.auditLogService.findAll(query);
  }

  @Get(':targetType/:targetId')
  @ApiOperation({ summary: 'Read the latest bounded audit summaries for one entity' })
  findByTarget(@Param() params: AuditLogTargetParamsDto, @Query() query: AuditLogTargetQueryDto) {
    return this.auditLogService.findByTarget(params.targetType, params.targetId, query.limit);
  }
}
