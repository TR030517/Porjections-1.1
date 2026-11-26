/**
 * MJAPP — SensitiveWord Controller
 *
 * Admin-only endpoints for managing the sensitive word dictionary.
 * All routes require JWT auth + ADMIN role.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { SensitiveWordService } from './sensitive-word.service';
import { Roles } from '../../common/guards/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Admin — Sensitive Words')
@Controller('admin/sensitive-words')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class SensitiveWordController {
  private readonly logger = new Logger(SensitiveWordController.name);

  constructor(private readonly sensitiveWordService: SensitiveWordService) {}

  // ───── Word dictionary CRUD ─────

  @Get()
  @ApiOperation({
    summary: 'List sensitive words',
    description: 'Paginated list with optional category/search/isActive filters.',
  })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.sensitiveWordService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      category,
      search,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Post()
  @ApiOperation({
    summary: 'Add a sensitive word',
    description: 'Creates a new word and rebuilds the AC automaton.',
  })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: { word: string; category?: string }) {
    return this.sensitiveWordService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a sensitive word',
    description: 'Edits the word/category/active status and rebuilds the automaton.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: { word?: string; category?: string; isActive?: boolean },
  ) {
    return this.sensitiveWordService.update(parseInt(id, 10), dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete a sensitive word',
    description: 'Sets isActive=false (does not physically delete).',
  })
  async remove(@Param('id') id: string) {
    return this.sensitiveWordService.remove(parseInt(id, 10));
  }

  // ───── Import / Export ─────

  @Post('import')
  @ApiOperation({
    summary: 'Batch import sensitive words',
    description: 'Accepts { words: string[], category?: string }. Skips duplicates.',
  })
  @HttpCode(HttpStatus.CREATED)
  async import(@Body() dto: { words: string[]; category?: string }) {
    return this.sensitiveWordService.import(dto.words, dto.category);
  }

  @Get('export')
  @ApiOperation({
    summary: 'Export sensitive words as CSV',
    description: 'Downloads a CSV file with columns: word, category, severity, createdAt.',
  })
  async export(@Res() res: Response) {
    const data = await this.sensitiveWordService.exportData();
    const header = 'word,category,severity,createdAt\n';
    const rows = data
      .map((r) => `${r.word},${r.category},${r.severity},${r.createdAt.toISOString()}`)
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sensitive-words.csv"');
    res.send(header + rows);
  }

  // ───── Hit Logs ─────

  @Get('hit-logs')
  @ApiOperation({
    summary: 'Query sensitive word hit logs',
    description: 'Paginated hit logs with optional targetType and date range filters.',
  })
  async getHitLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('targetType') targetType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.sensitiveWordService.getHitLogs({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      targetType,
      startDate,
      endDate,
    });
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get sensitive word statistics',
    description: 'Returns total word count and hit log counts.',
  })
  async getStats() {
    const totalWords = await this.sensitiveWordService.findAll({ limit: 1 });
    const totalHits = await this.sensitiveWordService.getHitLogCount();
    return {
      totalWords: totalWords.total,
      totalHits,
    };
  }
}
