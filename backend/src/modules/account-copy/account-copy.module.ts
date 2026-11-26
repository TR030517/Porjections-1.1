import { Module } from '@nestjs/common';
import { AccountCopyController } from './account-copy.controller';
import { AccountCopyService } from './account-copy.service';
@Module({ controllers: [AccountCopyController], providers: [AccountCopyService] })
export class AccountCopyModule {}
