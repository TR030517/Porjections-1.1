/**
 * MJAPP — Roles Decorator
 * Usage: @Roles('MERCHANT') or @Roles('ADMIN') on controller/handler
 */
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
