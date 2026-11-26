/**
 * MJAPP — Main Application Entry
 * Massajoy App: Chinese Massage Booking Platform
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { BigIntInterceptor } from './common/interceptors/bigint.interceptor';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Bounded bulk display menus can exceed Express's 100 KiB default. The menu
  // validator additionally limits its own UTF-8 content to 768 KiB.
  app.useBodyParser('json', { limit: '2mb' });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();

  // Security: Helmet headers
  app.use(helmet());

  // Same-origin by default; cross-origin requests require an explicit allowlist.
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    // 同源部署（Nginx 统一入口）无需 CORS；跨域仅放行白名单
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Idempotency-Key'],
  });

  // Global BigInt serialization interceptor
  app.useGlobalInterceptors(new BigIntInterceptor());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Massajoy2.0 API')
    .setDescription('Massajoy App — Chinese Massage Booking Platform API')
    .setVersion('2.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  if (!isProduction) SwaggerModule.setup('api-docs', app, document);

  const port = process.env.APP_PORT || 8002;
  await app.listen(port, process.env.APP_HOST || '127.0.0.1');
  logger.log(`Massajoy2.0 API listening on port ${port}`);
  if (!isProduction) logger.log(`Swagger docs: http://localhost:${port}/api-docs`);
}

bootstrap();
