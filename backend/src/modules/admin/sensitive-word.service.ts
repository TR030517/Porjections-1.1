/**
 * MJAPP — SensitiveWord Service
 *
 * Manages the sensitive word dictionary using an in-memory AC automaton.
 * On every CRUD operation the automaton is rebuilt from the database.
 * Provides checkText() for real-time scanning and automatic hit logging.
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AcAutomaton, AcMatch } from '../../common/utils/ac-automaton';

export interface CheckTextResult {
  isSensitive: boolean;
  matches: AcMatch[];
}

export interface CreateSensitiveWordDto {
  word: string;
  category?: string;
}

export interface UpdateSensitiveWordDto {
  word?: string;
  category?: string;
  isActive?: boolean;
}

export interface HitLogQueryDto {
  page?: number;
  limit?: number;
  targetType?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class SensitiveWordService implements OnModuleInit {
  private readonly logger = new Logger(SensitiveWordService.name);
  private readonly automaton = new AcAutomaton();
  private ready = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.rebuildAutomaton();
    this.ready = true;
    this.logger.log('AC automaton initialized from database');
  }

  /**
   * Rebuild the AC automaton from all active sensitive words in the DB.
   */
  async rebuildAutomaton(): Promise<void> {
    try {
      const words = await this.prisma.sensitiveWord.findMany({
        where: { isActive: true },
        select: { word: true },
      });
      const wordList = words.map((w) => w.word);
      this.automaton.build(wordList);
      this.logger.log(`AC automaton rebuilt with ${wordList.length} words`);
    } catch (err) {
      this.logger.error('Failed to rebuild AC automaton', err);
    }
  }

  /**
   * Check text against the AC automaton.
   * If isSensitive, automatically record a SensitiveHitLog.
   */
  checkText(
    text: string,
    targetType: string,
    targetId: number | bigint,
    userId: number | bigint,
    blocked: boolean,
  ): CheckTextResult {
    const matches = this.automaton.search(text);
    const isSensitive = matches.length > 0;

    if (isSensitive) {
      // Record hit log asynchronously (fire and forget)
      this.recordHitLogs(matches, targetType, targetId, userId, text, blocked).catch((err) => {
        this.logger.error('Failed to record sensitive hit log', err);
      });
    }

    return { isSensitive, matches };
  }

  /**
   * Check if text contains any sensitive word (no side effects).
   */
  containsSensitive(text: string): boolean {
    return this.automaton.containsSensitive(text);
  }

  /**
   * Filter sensitive words from text.
   */
  filterText(text: string, replace = '***'): string {
    return this.automaton.filter(text, replace);
  }

  /**
   * CRUD: List all sensitive words with pagination + filter.
   */
  async findAll(query: {
    page?: number;
    limit?: number;
    category?: string;
    search?: string;
    isActive?: boolean;
  }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.category) where.category = query.category;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.word = { contains: query.search };
    }

    const [items, total] = await Promise.all([
      this.prisma.sensitiveWord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.sensitiveWord.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * CRUD: Create a new sensitive word.
   */
  async create(dto: CreateSensitiveWordDto) {
    // Check for duplicate
    const existing = await this.prisma.sensitiveWord.findUnique({
      where: { word: dto.word },
    });
    if (existing) {
      throw new ConflictException(`Word "${dto.word}" already exists`);
    }

    const word = await this.prisma.sensitiveWord.create({
      data: {
        word: dto.word,
        category: dto.category ?? 'DEFAULT',
      },
    });

    await this.rebuildAutomaton();
    return word;
  }

  /**
   * CRUD: Update a sensitive word.
   */
  async update(id: number, dto: UpdateSensitiveWordDto) {
    const existing = await this.prisma.sensitiveWord.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Sensitive word #${id} not found`);
    }

    // If word is being changed, check uniqueness
    if (dto.word && dto.word !== existing.word) {
      const dup = await this.prisma.sensitiveWord.findUnique({
        where: { word: dto.word },
      });
      if (dup) {
        throw new ConflictException(`Word "${dto.word}" already exists`);
      }
    }

    const word = await this.prisma.sensitiveWord.update({
      where: { id },
      data: {
        ...(dto.word !== undefined && { word: dto.word }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.rebuildAutomaton();
    return word;
  }

  /**
   * CRUD: Soft-delete (deactivate) a sensitive word.
   */
  async remove(id: number) {
    const existing = await this.prisma.sensitiveWord.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Sensitive word #${id} not found`);
    }

    const word = await this.prisma.sensitiveWord.update({
      where: { id },
      data: { isActive: false },
    });

    await this.rebuildAutomaton();
    return word;
  }

  /**
   * Batch import sensitive words.
   */
  async import(words: string[], category?: string) {
    let created = 0;
    let skipped = 0;

    for (const w of words) {
      if (!w.trim()) continue;
      try {
        await this.prisma.sensitiveWord.create({
          data: {
            word: w.trim(),
            category: category ?? 'DEFAULT',
          },
        });
        created++;
      } catch {
        skipped++;
      }
    }

    if (created > 0) {
      await this.rebuildAutomaton();
    }

    return { created, skipped, total: words.length };
  }

  /**
   * Export all active sensitive words as an array.
   */
  async exportData(): Promise<{ word: string; category: string; severity: string; createdAt: Date }[]> {
    return this.prisma.sensitiveWord.findMany({
      where: { isActive: true },
      orderBy: { word: 'asc' },
      select: {
        word: true,
        category: true,
        severity: true,
        createdAt: true,
      },
    });
  }

  /**
   * Query hit logs with pagination and filters.
   */
  async getHitLogs(query: HitLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.targetType) where.targetType = query.targetType;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.sensitiveHitLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, phone: true },
          },
        },
      }),
      this.prisma.sensitiveHitLog.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Get total hit log count (for stats).
   */
  async getHitLogCount(targetType?: string): Promise<number> {
    const where: any = {};
    if (targetType) where.targetType = targetType;
    return this.prisma.sensitiveHitLog.count({ where });
  }

  // ───── private helpers ─────

  private async recordHitLogs(
    matches: AcMatch[],
    targetType: string,
    targetId: number | bigint,
    userId: number | bigint,
    text: string,
    blocked: boolean,
  ) {
    // Deduplicate by word for logging
    const seen = new Set<string>();
    for (const match of matches) {
      if (seen.has(match.word)) continue;
      seen.add(match.word);

      // Find the word record to get its ID
      const wordRecord = await this.prisma.sensitiveWord.findUnique({
        where: { word: match.word },
      });

      if (!wordRecord) {
        this.logger.warn(`Sensitive word "${match.word}" not found in DB, skipping hit log`);
        continue;
      }

      const snippet = text.slice(
        Math.max(0, match.startIndex - 20),
        Math.min(text.length, match.endIndex + 20),
      );

      await this.prisma.sensitiveHitLog.create({
        data: {
          wordId: wordRecord.id,
          word: match.word,
          targetType,
          targetId: typeof targetId === 'bigint' ? targetId : BigInt(targetId),
          content: snippet.slice(0, 200),
          userId: typeof userId === 'bigint' ? userId : BigInt(userId),
          blocked,
        },
      });
    }
  }
}
