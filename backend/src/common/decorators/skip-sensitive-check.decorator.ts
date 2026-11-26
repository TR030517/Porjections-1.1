/**
 * MJAPP — @SkipSensitiveCheck() Decorator
 *
 * Use on controller handlers to skip the sensitive word interceptor.
 *   @SkipSensitiveCheck()
 *   @Post('something')
 *   create() { ... }
 */

import { SetMetadata } from '@nestjs/common';

export const SKIP_SENSITIVE_CHECK_KEY = 'skip_sensitive_check';
export const SkipSensitiveCheck = () => SetMetadata(SKIP_SENSITIVE_CHECK_KEY, true);
