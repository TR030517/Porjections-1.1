/**
 * MJAPP — Root Service
 */

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}
  async getHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const folder = join(__dirname, '../prisma/migrations');
      const required = readdirSync(folder, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && existsSync(join(folder, entry.name, 'migration.sql')))
        .map(entry => entry.name);
      const applied = await this.prisma.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      const names = new Set(applied.map(row => row.migration_name));
      if (!required.length || required.some(name => !names.has(name))) throw new Error('Missing migrations');
    } catch {
      throw new ServiceUnavailableException('Database connection or release migrations are not ready');
    }
    return {
      status: 'healthy',
      app: 'Massajoy2.0',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  getRoot() {
    return {
      message: 'Massajoy2.0 API',
      health: '/api/v1/health',
    };
  }
}
