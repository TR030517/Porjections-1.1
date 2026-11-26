/**
 * MJAPP — Sensitive Word Interceptor
 *
 * Automatically scans request body fields that may contain user-generated
 * text (name, description, comment, content, notes, address, bio, etc.)
 * for sensitive words.
 *
 * When a hit is found:
 *   - The request is rejected with a 400 BadRequest error
 *   - A SensitiveHitLog record is created
 *
 * Use @SkipSensitiveCheck() on handlers that must bypass this check.
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { SensitiveWordService } from '../../modules/admin/sensitive-word.service';
import { SKIP_SENSITIVE_CHECK_KEY } from '../decorators/skip-sensitive-check.decorator';

/** Fields to scan for sensitive content in request bodies */
const SENSITIVE_FIELDS = [
  'name',
  'nameEn',
  'description',
  'comment',
  'content',
  'notes',
  'address',
  'bio',
  'reason',
  'replyContent',
  'cancelReason',
];

@Injectable()
export class SensitiveWordInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SensitiveWordInterceptor.name);

  constructor(
    private readonly sensitiveWordService: SensitiveWordService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_SENSITIVE_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skip) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const body = request.body;
    const method = request.method;

    // Only check write methods
    if (!['POST', 'PUT', 'PATCH'].includes(method)) {
      return next.handle();
    }

    if (!body || typeof body !== 'object') {
      return next.handle();
    }

    // Determine target type from the URL path
    const path: string = request.url || '';
    let targetType: string = 'REVIEW';
    if (path.includes('/shops') || path.includes('/shop')) {
      targetType = 'SHOP';
    } else if (path.includes('/services') || path.includes('/service')) {
      targetType = 'SERVICE';
    } else if (path.includes('/reviews') || path.includes('/review')) {
      targetType = 'REVIEW';
    } else if (path.includes('/profile') || path.includes('/users') || path.includes('/user')) {
      targetType = 'PROFILE';
    }

    const userId = request.user?.id ? Number(request.user.id) : 0;

    // Walk through body fields and check sensitive fields
    for (const field of SENSITIVE_FIELDS) {
      const value = body[field];
      if (!value || typeof value !== 'string') continue;

      const result = this.sensitiveWordService.checkText(
        value,
        targetType,
        0, // targetId unknown at this point
        userId,
        true, // block
      );

      if (result.isSensitive && result.matches && result.matches.length > 0) {
        const hitWords = result.matches.map((m) => m.word).join(', ');
        this.logger.warn(
          `Sensitive word blocked [${hitWords}] in field "${field}" from user ${userId} on ${path}`,
        );
        throw new BadRequestException(
          `Content contains prohibited words: ${hitWords}`,
        );
      }
    }

    return next.handle();
  }
}
