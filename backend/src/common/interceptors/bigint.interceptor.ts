/**
 * MJAPP — BigInt Serialization Interceptor
 * 
 * Prisma returns BigInt for auto-increment IDs. JSON.stringify
 * can't serialize BigInt natively. This interceptor converts
 * all BigInt values to strings while preserving Date, Buffer, etc.
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => this.serialize(data)),
    );
  }

  private serialize(value: any): any {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      return value;
    }
    // Preserve Date objects
    if (value instanceof Date) return value.toISOString();
    // Preserve Buffer
    if (Buffer.isBuffer(value)) return value.toString('base64');
    // Handle arrays
    if (Array.isArray(value)) return value.map((item) => this.serialize(item));
    // Handle plain objects
    if (typeof value === 'object' && value.constructor === Object) {
      const result: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.serialize(val);
      }
      return result;
    }
    // Fallback for other types (Map, Set, custom classes etc.)
    return value;
  }
}
