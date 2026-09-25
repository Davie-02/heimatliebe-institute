import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { StaffRoute } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { SessionClaims } from "../auth/session.service";
import { actorFrom } from "../common/actor";
import { FinanceService } from "./finance.service";
import { BulkInvoiceDto, RecordPaymentDto, RejectPaymentDto } from "./finance.dto";

@Controller("finance")
@StaffRoute()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("summary")
  summary() {
    return this.finance.summary();
  }

  @Get("debtors")
  debtors() {
    return this.finance.debtors();
  }

  @Get("statement/:studentId")
  statement(@Param("studentId") studentId: string) {
    return this.finance.statement(studentId);
  }

  @Get("receipt/:paymentId")
  receipt(@Param("paymentId") paymentId: string) {
    return this.finance.receipt(paymentId);
  }

  @Post("payments")
  record(@Body() dto: RecordPaymentDto, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.finance.recordPayment(dto, actorFrom(user, request));
  }

  @Post("payments/:id/confirm")
  @HttpCode(200)
  confirm(@Param("id") id: string, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.finance.confirmPayment(id, actorFrom(user, request));
  }

  @Post("payments/:id/reject")
  @HttpCode(200)
  reject(@Param("id") id: string, @Body() dto: RejectPaymentDto, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.finance.rejectPayment(id, dto.reason, actorFrom(user, request));
  }

  @Post("invoices/bulk")
  bulk(@Body() dto: BulkInvoiceDto, @CurrentUser() user: SessionClaims, @Req() request: Request) {
    return this.finance.bulkInvoice(dto, actorFrom(user, request));
  }
}
