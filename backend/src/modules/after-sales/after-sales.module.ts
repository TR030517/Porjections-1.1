import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PaymentModule } from "../payment/payment.module";
import { AfterSalesController } from "./after-sales.controller";
import { AfterSalesService } from "./after-sales.service";

@Module({
  imports: [AuthModule, PaymentModule],
  controllers: [AfterSalesController],
  providers: [AfterSalesService],
  exports: [AfterSalesService],
})
export class AfterSalesModule {}
