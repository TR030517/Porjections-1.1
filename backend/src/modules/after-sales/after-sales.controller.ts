import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { GetUser } from "../../common/decorators/get-user.decorator";
import { AfterSalesService } from "./after-sales.service";
import {
  AfterSalesListDto,
  AfterSalesNoteDto,
  AfterSalesTransitionDto,
  AfterSalesVersionDto,
  CaseActor,
  CreateAfterSalesDto,
} from "./after-sales.dto";

@Controller("after-sales")
@UseGuards(AuthGuard("jwt"))
export class AfterSalesController {
  constructor(private readonly service: AfterSalesService) {}
  @Post() create(
    @GetUser() actor: CaseActor,
    @Body() body: CreateAfterSalesDto,
  ) {
    return this.service.create(actor, body);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@GetUser() actor: CaseActor, @Query() query: AfterSalesListDto) {
    return this.service.list(actor, query);
  }
  @Get(":id")
  @Header('Cache-Control', 'no-store')
  detail(@GetUser() actor: CaseActor, @Param("id") id: string) {
    return this.service.detail(actor, id);
  }
  @Get(":id/events")
  @Header('Cache-Control', 'no-store')
  events(
    @GetUser() actor: CaseActor,
    @Param("id") id: string,
    @Query() query: AfterSalesListDto,
  ) {
    return this.service.events(actor, id, query);
  }
  @Post(":id/claim") claim(
    @GetUser() actor: CaseActor,
    @Param("id") id: string,
    @Body() body: AfterSalesVersionDto,
  ) {
    return this.service.claim(actor, id, body);
  }
  @Post(":id/notes") note(
    @GetUser() actor: CaseActor,
    @Param("id") id: string,
    @Body() body: AfterSalesNoteDto,
  ) {
    return this.service.note(actor, id, body);
  }
  @Post(":id/transition") transition(
    @GetUser() actor: CaseActor,
    @Param("id") id: string,
    @Body() body: AfterSalesTransitionDto,
  ) {
    return this.service.transition(actor, id, body);
  }
  @Post(":id/refund") refund(
    @GetUser() actor: CaseActor,
    @Param("id") id: string,
    @Body() body: AfterSalesVersionDto,
  ) {
    return this.service.refund(actor, id, body);
  }
  @Post(":id/reconcile") reconcile(
    @GetUser() actor: CaseActor,
    @Param("id") id: string,
    @Body() body: AfterSalesVersionDto,
  ) {
    return this.service.reconcile(actor, id, body);
  }
}
