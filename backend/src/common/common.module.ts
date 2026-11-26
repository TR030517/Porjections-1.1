import { Global, Module } from '@nestjs/common';
import { PublicSupportController } from './public-support.controller';
import { I18nService } from './i18n/i18n.service';

@Global()
@Module({
  controllers: [PublicSupportController],
  providers: [I18nService],
  exports: [I18nService],
})
export class CommonModule {}
