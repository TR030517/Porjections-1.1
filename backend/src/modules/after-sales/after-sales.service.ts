import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { requireShopAccess } from "../../common/shop-access";
import { PrismaService } from "../../prisma/prisma.service";
import { PaymentService } from "../payment/payment.service";
import { lockShop, reservationTransaction } from "../booking/lifecycle";
import { bookingLocalFields } from "../booking/time";
import {
  AfterSalesListDto,
  AfterSalesNoteDto,
  AfterSalesTransitionDto,
  AfterSalesVersionDto,
  CaseActor,
  CreateAfterSalesDto,
} from "./after-sales.dto";
import {
  ACTIVE_CASE_STATUSES,
  assertActive,
  assertActor,
  assertOperator,
  assertVersion,
  caseId,
  caseObject,
  caseText,
  listQuery,
  requestedAmount,
  transitionTarget,
} from "./after-sales.rules";

const BOOKING = {
  id: true,
  bookingNo: true,
  userId: true,
  shopId: true,
  status: true,
  paymentMode: true,
  paymentStatus: true,
  paidCents: true,
  refundedCents: true,
  currency: true,
  startTime: true,
  endTime: true,
  bookingTimezone: true,
  deletedAt: true,
  shop: { select: { ownerId: true, name: true, loginBinding: { select: { userId: true } } } },
  service: { select: { name: true } },
} as const;
const WITH_BOOKING = { booking: { select: BOOKING } } as const;
type CaseRow = {
  id: bigint;
  bookingId: bigint;
  shopId: bigint;
  customerId: bigint;
  activeBookingId: bigint | null;
  type: string;
  status: string;
  reason: string;
  requestedAmountCents: number | null;
  currency: string;
  assignedToId: bigint | null;
  acceptedAt: Date | null;
  version: number;
  refundKey: string | null;
  refundState: string;
  refundRequestId: string | null;
  offlineRefundRecordedCents?: number | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  booking: Prisma.BookingGetPayload<{ select: typeof BOOKING }>;
};

@Injectable()
export class AfterSalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
  ) {}

  private scope(actor: CaseActor): Prisma.AfterSalesCaseWhereInput {
    assertActor(actor);
    return actor.role === "CUSTOMER"
      ? { customerId: caseId(actor.id) }
      : actor.role === "MERCHANT"
        ? { shop: { deletedAt: null, loginBinding: { is: { userId: caseId(actor.id), user: { role: "MERCHANT", status: "ACTIVE", deletedAt: null } } } } }
        : {};
  }
  private readable(
    row: CaseRow | null,
    actor: CaseActor,
  ): asserts row is CaseRow {
    assertActor(actor);
    if (
      !row ||
      row.bookingId !== row.booking.id ||
      row.shopId !== row.booking.shopId ||
      row.customerId !== row.booking.userId ||
      (actor.role === "CUSTOMER" && row.customerId !== caseId(actor.id)) ||
      (actor.role === "MERCHANT" &&
        row.booking.shop.loginBinding?.userId !== caseId(actor.id))
    )
      throw new NotFoundException("After-sales case not found");
  }
  private handler(row: CaseRow, actor: CaseActor) {
    assertOperator(actor);
    if (actor.role !== "ADMIN" && row.assignedToId !== caseId(actor.id))
      throw new ConflictException("Claim this case before processing it");
  }
  private async lockCase(
    tx: any,
    actor: CaseActor,
    value: string,
  ): Promise<CaseRow> {
    const id = caseId(value);
    const hint = await tx.afterSalesCase.findFirst({
      where: { id, ...this.scope(actor) },
      include: WITH_BOOKING,
    });
    this.readable(hint, actor);
    // Same shop -> booking lock order as payment/reservation writers. No external I/O inside this transaction.
    await lockShop(tx, hint.shopId);
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM bookings WHERE id = ${hint.bookingId} FOR UPDATE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM after_sales_cases WHERE id = ${id} FOR UPDATE`,
    );
    const row = await tx.afterSalesCase.findUnique({
      where: { id },
      include: WITH_BOOKING,
    });
    this.readable(row, actor);
    if (actor.role !== "CUSTOMER") await requireShopAccess(tx, row!.shopId, actor, "OWNER_ONLY", { write: true });
    return row;
  }
  private async event(
    tx: any,
    actor: CaseActor,
    row: CaseRow,
    kind: string,
    content: string | null,
    visibility = "PUBLIC",
    toStatus = row.status,
  ) {
    await tx.afterSalesEvent.create({
      data: {
        caseId: row.id,
        actorId: caseId(actor.id),
        kind,
        visibility,
        content,
        fromStatus: row.status,
        toStatus,
      },
    });
    await tx.auditLog.create({
      data: {
        operatorId: caseId(actor.id),
        targetType: "AFTER_SALES",
        targetId: row.id,
        action: "AFTER_SALES_" + kind,
        // Raw complaint/reason/notes and payment identifiers belong only to the permissioned timeline.
        detail: {
          previousStatus: row.status,
          newStatus: toStatus,
          visibility,
          hasContent: !!content,
        },
      },
    });
  }
  private async update(tx: any, row: CaseRow, data: Record<string, unknown>) {
    const result = await tx.afterSalesCase.updateMany({
      where: { id: row.id, version: row.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count !== 1)
      throw new ConflictException(
        "Case changed; reload before repeating this action",
      );
  }
  private async reconcileRefund(
    tx: any,
    actor: CaseActor,
    row: CaseRow,
  ): Promise<CaseRow> {
    if (!row.refundKey) return row;
    const request = await tx.refundRequest.findUnique({
      where: { idempotencyKey: row.refundKey },
      select: { id: true, bookingId: true, amountCents: true, status: true },
    });
    if (!request) return row;
    if (
      request.bookingId !== row.bookingId ||
      request.amountCents !== row.requestedAmountCents
    )
      throw new ConflictException(
        "Refund request does not match this case; reconciliation is required",
      );
    if (
      !["PENDING", "RETRYABLE", "SUCCEEDED", "FAILED"].includes(request.status)
    )
      throw new ConflictException(
        "Unknown refund status requires reconciliation",
      );
    if (
      row.refundState !== request.status ||
      row.refundRequestId !== request.id
    ) {
      await this.update(tx, row, {
        refundState: request.status,
        refundRequestId: request.id,
      });
      await this.event(tx, actor, row, "REFUND_" + request.status, null);
      return tx.afterSalesCase.findUniqueOrThrow({
        where: { id: row.id },
        include: WITH_BOOKING,
      });
    }
    return row;
  }
  private allowedActions(row: CaseRow, actor: CaseActor) {
    if (!ACTIVE_CASE_STATUSES.includes(row.status)) return [];
    const actions = ["NOTE"];
    if (actor.role === "CUSTOMER") {
      try {
        transitionTarget(row, "WITHDRAW", actor);
        actions.push("WITHDRAW");
      } catch {
        /* Server state excludes this action. */
      }
      return actions;
    }
    if (
      row.assignedToId !== caseId(actor.id) &&
      (row.assignedToId === null || actor.role === "ADMIN")
    )
      actions.push("CLAIM");
    if (actor.role !== "ADMIN" && row.assignedToId !== caseId(actor.id))
      return actions;
    if (
      row.type === "REFUND" &&
      row.booking.paymentMode !== "PAY_AT_STORE" &&
      row.refundKey
    )
      actions.push("RECONCILE");
    for (const action of [
      "ACCEPT",
      "WAIT_FOR_CUSTOMER",
      "RESUME",
      "REJECT",
      "RESOLVE",
    ] as const) {
      try {
        transitionTarget(row, action, actor);
        actions.push(action);
      } catch {
        /* Server state excludes this action. */
      }
    }
    if (
      row.type === "REFUND" &&
      row.booking.paymentMode !== "PAY_AT_STORE" &&
      row.acceptedAt &&
      row.status === "IN_PROGRESS" &&
      !["SUCCEEDED", "FAILED"].includes(row.refundState)
    )
      actions.push("REFUND");
    return actions;
  }
  private projection(row: CaseRow, actor: CaseActor) {
    const b = row.booking;
    return {
      id: row.id.toString(),
      bookingId: row.bookingId.toString(),
      shopId: row.shopId.toString(),
      ...(actor.role === "CUSTOMER"
        ? {}
        : {
            customerId: row.customerId.toString(),
            assignedToId: row.assignedToId?.toString() ?? null,
          }),
      type: row.type,
      status: row.status,
      reason: row.reason,
      requestedAmountCents: row.requestedAmountCents,
      currency: row.currency,
      acceptedAt: row.acceptedAt,
      version: row.version,
      refundState: row.refundState,
      refundMode: b.paymentMode === "PAY_AT_STORE" ? "PAY_AT_STORE" : "ONLINE",
      offlineRefundRecordedCents: row.offlineRefundRecordedCents ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      closedAt: row.closedAt,
      allowedActions: this.allowedActions(row, actor),
      booking: {
        id: b.id.toString(),
        bookingNo: b.bookingNo,
        status: b.status,
        paymentStatus: b.paymentStatus,
        paidCents: b.paidCents,
        refundedCents: b.refundedCents,
        currency: b.currency,
        startTime: b.startTime,
        endTime: b.endTime,
        ...bookingLocalFields(b),
        shopName: b.shop.name,
        serviceName: b.service.name,
      },
    };
  }
  private eventProjection(row: any, actor: CaseActor) {
    return {
      id: row.id.toString(),
      kind: row.kind,
      visibility: row.visibility,
      content: row.content,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      createdAt: row.createdAt,
      actorRole: row.actor.role,
      ...(actor.role === "CUSTOMER" ? {} : { actorId: row.actorId.toString() }),
    };
  }
  private async withOfflineRefunds(
    db: Prisma.TransactionClient,
    rows: CaseRow[],
  ): Promise<CaseRow[]> {
    const candidates = rows.filter(
      (row): row is CaseRow & { requestedAmountCents: number } =>
        row.type === "REFUND" &&
        row.booking.paymentMode === "PAY_AT_STORE" &&
        !["REJECTED", "WITHDRAWN"].includes(row.status) &&
        (row.status !== "RESOLVED" || row.refundState === "SUCCEEDED") &&
        row.booking.paymentStatus === "REFUNDED" &&
        ["CANCELLED", "COMPLETED"].includes(row.booking.status) &&
        row.booking.paidCents === row.booking.refundedCents &&
        row.booking.currency === row.currency &&
        row.requestedAmountCents !== null &&
        Number.isSafeInteger(row.requestedAmountCents) &&
        row.requestedAmountCents > 0 &&
        row.booking.refundedCents >= row.requestedAmountCents,
    );
    const recordedAmounts = new Map<bigint, number>();
    if (candidates.length) {
      const bookingIds = [...new Set(candidates.map((row) => row.bookingId))];
      const keys = candidates.flatMap((row) => row.refundKey ? [row.refundKey] : []);
      const requestIds = candidates.flatMap((row) => row.refundRequestId ? [row.refundRequestId] : []);
      const [entries, payments, requests] = await Promise.all([
        db.bookingSettlementEntry.findMany({
          where: { bookingId: { in: bookingIds }, kind: "REFUND" },
          select: { bookingId: true, amountCents: true, currency: true, createdAt: true },
        }),
        db.paymentRecord.findMany({
          where: { bookingId: { in: bookingIds } },
          select: { bookingId: true },
        }),
        db.refundRequest.findMany({
          where: {
            OR: [
              { bookingId: { in: bookingIds } },
              { id: { in: requestIds } },
              { idempotencyKey: { in: keys } },
            ],
          },
          select: { bookingId: true, id: true, idempotencyKey: true },
        }),
      ]);
      for (const row of candidates) {
        const hasOnlineEvidence =
          payments.some((payment) => payment.bookingId === row.bookingId) ||
          requests.some((request) =>
            request.bookingId === row.bookingId ||
            request.id === row.refundRequestId ||
            request.idempotencyKey === row.refundKey,
          );
        if (hasOnlineEvidence) continue;
        const refunds = entries.filter((entry) => entry.bookingId === row.bookingId);
        if (refunds.some((entry) =>
          entry.currency !== row.currency ||
          !Number.isSafeInteger(entry.amountCents) ||
          entry.amountCents <= 0,
        )) continue;
        const total = refunds.reduce((sum, entry) => sum + entry.amountCents, 0);
        if (!Number.isSafeInteger(total) || total !== row.booking.refundedCents) continue;

        // Both writes hold the booking lock. Case creation requires a positive
        // refundable balance, so a full refund in the same millisecond followed
        // the case creation. The manually supplied transaction time can be backdated.
        const recorded = refunds
          .filter((entry) => entry.createdAt >= row.createdAt)
          .reduce((sum, entry) => sum + entry.amountCents, 0);
        if (recorded >= row.requestedAmountCents) recordedAmounts.set(row.id, recorded);
      }
    }
    return rows.map((row) => {
      if (row.type !== "REFUND" || row.booking.paymentMode !== "PAY_AT_STORE") return row;
      const offlineRefundRecordedCents = recordedAmounts.get(row.id) ?? null;
      let refundState = row.refundState;
      if (offlineRefundRecordedCents !== null) refundState = "SUCCEEDED";
      else if (refundState === "SUCCEEDED") refundState = "RETRYABLE";
      return { ...row, offlineRefundRecordedCents, refundState };
    });
  }
  private async effectiveRefunds(rows: CaseRow[]): Promise<CaseRow[]> {
    const keys = rows.flatMap((row) =>
      row.booking.paymentMode !== "PAY_AT_STORE" && row.refundKey ? [row.refundKey] : [],
    );
    const withOfflineRefunds = await this.withOfflineRefunds(this.prisma, rows);
    if (!keys.length) return withOfflineRefunds;
    const requests = await this.prisma.refundRequest.findMany({
      where: { idempotencyKey: { in: keys } },
      select: {
        id: true,
        idempotencyKey: true,
        bookingId: true,
        amountCents: true,
        status: true,
      },
    });
    return withOfflineRefunds.map((row) => {
      if (row.booking.paymentMode === "PAY_AT_STORE") return row;
      const request = requests.find(
        (item) => item.idempotencyKey === row.refundKey,
      );
      if (!request) return row;
      if (
        request.bookingId !== row.bookingId ||
        request.amountCents !== row.requestedAmountCents ||
        !["PENDING", "RETRYABLE", "SUCCEEDED", "FAILED"].includes(
          request.status,
        )
      )
        throw new ConflictException("Refund request requires reconciliation");
      // Read-only projection reflects webhook progress without changing case
      // version or exposing the internal payment request/key to the client.
      return {
        ...row,
        refundRequestId: request.id,
        refundState: request.status,
      };
    });
  }
  private async row(actor: CaseActor, id: string): Promise<CaseRow> {
    const row = await this.prisma.afterSalesCase.findFirst({
      where: { id: caseId(id), ...this.scope(actor) },
      include: WITH_BOOKING,
    });
    this.readable(row, actor);
    if (actor.role !== "CUSTOMER") await requireShopAccess(this.prisma, row!.shopId, actor, "OWNER_ONLY");
    return row;
  }
  async detail(actor: CaseActor, id: string) {
    const [row] = await this.effectiveRefunds([await this.row(actor, id)]);
    const where = {
      caseId: row.id,
      ...(actor.role === "CUSTOMER" ? { visibility: "PUBLIC" } : {}),
    };
    const [timeline, total] = await Promise.all([
      this.prisma.afterSalesEvent.findMany({
        where,
        orderBy: { id: "desc" },
        take: 100,
        include: { actor: { select: { role: true } } },
      }),
      this.prisma.afterSalesEvent.count({ where }),
    ]);
    return {
      ...this.projection(row, actor),
      timeline: timeline
        .reverse()
        .map((event) => this.eventProjection(event, actor)),
      timelineTotal: total,
      timelineHasMore: total > timeline.length,
    };
  }
  async events(actor: CaseActor, id: string, raw: unknown) {
    const query = caseObject(raw, ["page", "pageSize"]);
    const { page, pageSize } = listQuery(query);
    const row = await this.row(actor, id),
      where = {
        caseId: row.id,
        ...(actor.role === "CUSTOMER" ? { visibility: "PUBLIC" } : {}),
      };
    const [items, total] = await Promise.all([
      this.prisma.afterSalesEvent.findMany({
        where,
        orderBy: { id: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { role: true } } },
      }),
      this.prisma.afterSalesEvent.count({ where }),
    ]);
    return {
      items: items.map((event) => this.eventProjection(event, actor)),
      total,
      page,
      pageSize,
    };
  }
  async list(actor: CaseActor, raw: AfterSalesListDto) {
    const { page, pageSize, bookingNo, ...filter } = listQuery(raw);
    const where = { ...filter, ...(bookingNo !== undefined ? { booking: { bookingNo } } : {}), ...this.scope(actor) };
    const [items, total] = await Promise.all([
      this.prisma.afterSalesCase.findMany({
        where,
        include: WITH_BOOKING,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.afterSalesCase.count({ where }),
    ]);
    const effective = await this.effectiveRefunds(items);
    return {
      items: effective.map((row) => {
        this.readable(row, actor);
        return this.projection(row, actor);
      }),
      total,
      page,
      pageSize,
    };
  }
  async create(actor: CaseActor, body: CreateAfterSalesDto) {
    assertActor(actor);
    if (actor.role !== "CUSTOMER")
      throw new ForbiddenException(
        "Only the booking customer may submit an after-sales case",
      );
    const raw = caseObject(body, [
        "bookingId",
        "type",
        "reason",
        "requestedAmountCents",
      ]),
      bookingId = caseId(raw.bookingId),
      reason = caseText(raw.reason, "Reason");
    let id: bigint;
    try {
      id = await reservationTransaction(this.prisma, async (tx) => {
        const hint = await tx.booking.findUnique({
          where: { id: bookingId },
          select: { shopId: true, userId: true, deletedAt: true },
        });
        if (!hint || hint.deletedAt || hint.userId !== caseId(actor.id))
          throw new NotFoundException("Booking not found");
        await lockShop(tx, hint.shopId);
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`,
        );
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
          select: BOOKING,
        });
        if (booking.deletedAt || booking.userId !== caseId(actor.id))
          throw new NotFoundException("Booking not found");
        const amount = requestedAmount(
          raw.type,
          raw.requestedAmountCents,
          booking.paidCents,
          booking.refundedCents,
        );
        if (
          await tx.afterSalesCase.findFirst({
            where: { bookingId, status: { in: ACTIVE_CASE_STATUSES } },
            select: { id: true },
          })
        )
          throw new ConflictException(
            "This booking already has an active after-sales case",
          );
        if (
          typeof booking.currency !== "string" ||
          !/^[a-zA-Z]{3}$/.test(booking.currency)
        )
          throw new ConflictException(
            "Booking currency requires reconciliation",
          );
        const row = await tx.afterSalesCase.create({
          data: {
            bookingId,
            shopId: booking.shopId,
            customerId: booking.userId,
            activeBookingId: bookingId,
            type: raw.type,
            status: "OPEN",
            reason,
            requestedAmountCents: amount,
            currency: booking.currency,
          },
          include: WITH_BOOKING,
        });
        await this.event(tx, actor, row, "CREATED", reason);
        return row.id;
      });
    } catch (error) {
      if ((error as any).code === "P2002")
        throw new ConflictException(
          "This booking already has an active after-sales case",
        );
      throw error;
    }
    return this.detail(actor, id.toString());
  }
  async claim(actor: CaseActor, id: string, body: AfterSalesVersionDto) {
    assertOperator(actor);
    const raw = caseObject(body, ["version"]);
    await reservationTransaction(this.prisma, async (tx) => {
      const row = await this.lockCase(tx, actor, id);
      assertVersion(row.version, raw.version);
      assertActive(row);
      if (row.assignedToId === caseId(actor.id))
        throw new ConflictException("Case is already assigned to you");
      if (row.assignedToId !== null && actor.role !== "ADMIN")
        throw new ConflictException("Case is assigned to another handler");
      const status = row.status === "OPEN" ? "IN_PROGRESS" : row.status;
      await this.update(tx, row, { assignedToId: caseId(actor.id), status });
      await this.event(tx, actor, row, "CLAIMED", null, "INTERNAL", status);
    });
    return this.detail(actor, id);
  }
  async note(actor: CaseActor, id: string, body: AfterSalesNoteDto) {
    const raw = caseObject(body, ["version", "content", "visibility"]),
      content = caseText(raw.content, "Note");
    assertActor(actor);
    const visibility =
      raw.visibility ?? (actor.role === "CUSTOMER" ? "PUBLIC" : "INTERNAL");
    if (!["PUBLIC", "INTERNAL"].includes(visibility as string))
      throw new BadRequestException("Invalid note visibility");
    if (actor.role === "CUSTOMER" && visibility !== "PUBLIC")
      throw new ForbiddenException("Customer replies must be public");
    await reservationTransaction(this.prisma, async (tx) => {
      const row = await this.lockCase(tx, actor, id);
      assertVersion(row.version, raw.version);
      assertActive(row);
      const status =
        actor.role === "CUSTOMER" && row.status === "WAITING_CUSTOMER"
          ? "IN_PROGRESS"
          : row.status;
      await this.update(tx, row, { status });
      await this.event(
        tx,
        actor,
        row,
        "NOTE",
        content,
        visibility as string,
        status,
      );
    });
    return this.detail(actor, id);
  }
  async transition(
    actor: CaseActor,
    id: string,
    body: AfterSalesTransitionDto,
  ) {
    const raw = caseObject(body, ["version", "action", "reason"]);
    await reservationTransaction(this.prisma, async (tx) => {
      let row = await this.lockCase(tx, actor, id);
      assertVersion(row.version, raw.version);
      // A successful webhook can be reconciled before RESOLVE; caller must still
      // have supplied the current version that existed before this atomic action.
      if (raw.action !== "WITHDRAW") this.handler(row, actor);
      const offline = row.booking.paymentMode === "PAY_AT_STORE";
      if (offline) [row] = await this.withOfflineRefunds(tx, [row]);
      else row = await this.reconcileRefund(tx, actor, row);
      const target = transitionTarget(row, raw.action, actor),
        reason = caseText(raw.reason, "Public reason", target.reasonRequired);
      const resolvingRefund = raw.action === "RESOLVE" && row.type === "REFUND";
      if (resolvingRefund && !offline) {
        const refund = row.refundRequestId
          ? await tx.refundRequest.findUnique({
              where: { id: row.refundRequestId },
              select: { status: true, bookingId: true, amountCents: true },
            })
          : null;
        if (
          !refund ||
          refund.status !== "SUCCEEDED" ||
          refund.bookingId !== row.bookingId ||
          refund.amountCents !== row.requestedAmountCents
        )
          throw new ConflictException(
            "The linked refund must succeed before closing this case",
          );
      }
      const terminal = !ACTIVE_CASE_STATUSES.includes(target.status);
      await this.update(tx, row, {
        status: target.status,
        ...(resolvingRefund && offline ? { refundState: "SUCCEEDED" } : {}),
        ...(raw.action === "ACCEPT"
          ? {
              acceptedAt: new Date(),
              assignedToId: row.assignedToId ?? caseId(actor.id),
            }
          : {}),
        ...(terminal ? { activeBookingId: null, closedAt: new Date() } : {}),
      });
      await this.event(
        tx,
        actor,
        row,
        String(raw.action),
        reason || null,
        "PUBLIC",
        target.status,
      );
    });
    return this.detail(actor, id);
  }
  async refund(actor: CaseActor, id: string, body: AfterSalesVersionDto) {
    assertOperator(actor);
    const raw = caseObject(body, ["version"]);
    const intent = await reservationTransaction(this.prisma, async (tx) => {
      let row = await this.lockCase(tx, actor, id);
      assertVersion(row.version, raw.version);
      this.handler(row, actor);
      assertActive(row);
      if (row.booking.paymentMode === "PAY_AT_STORE")
        throw new ConflictException("Pay-at-store refunds must be recorded in booking settlement");
      if (!this.payments.isRefundProviderAvailable())
        throw new ServiceUnavailableException(
          "Refund processing is not configured; no refund was started",
        );
      if (
        row.type !== "REFUND" ||
        !row.acceptedAt ||
        row.status !== "IN_PROGRESS"
      )
        throw new ConflictException(
          "Only an accepted refund case in progress can execute its refund",
        );
      row = await this.reconcileRefund(tx, actor, row);
      if (row.refundState === "SUCCEEDED")
        return {
          done: true,
          bookingId: row.bookingId.toString(),
          amount: row.requestedAmountCents!,
          key: row.refundKey!,
        };
      if (row.refundState === "FAILED")
        throw new ConflictException(
          "This refund definitively failed; reject this case with a public reason rather than issuing another request",
        );
      if (
        !Number.isInteger(row.requestedAmountCents) ||
        row.requestedAmountCents! <= 0
      )
        throw new ConflictException("Requested refund amount is unavailable");
      const key = row.refundKey ?? `after-sales:${row.id}:refund`;
      await this.update(tx, row, { refundKey: key, refundState: "IN_FLIGHT" });
      await this.event(tx, actor, row, "REFUND_REQUESTED", null);
      return {
        done: false,
        bookingId: row.bookingId.toString(),
        amount: row.requestedAmountCents!,
        key,
      };
    });
    if (intent.done) return this.detail(actor, id);
    let failed = false;
    try {
      await this.payments.refundBooking(
        intent.bookingId,
        actor.id,
        actor.role,
        intent.amount,
        intent.key,
      );
    } catch {
      failed = true;
    }
    // Provider I/O ended (or timed out) outside the DB lock. Persist only the
    // authoritative RefundRequest, never a client/provider response alone.
    await reservationTransaction(this.prisma, async (tx) => {
      let row = await this.lockCase(tx, actor, id);
      row = await this.reconcileRefund(tx, actor, row);
      if (!row.refundRequestId && row.refundState === "IN_FLIGHT") {
        // A timeout/crash can race another retry still preparing the same key.
        // Never un-fence closure based only on an absent request observed now.
        await this.update(tx, row, { refundState: "RETRYABLE" });
        await this.event(
          tx,
          actor,
          row,
          "REFUND_RECONCILIATION_REQUIRED",
          null,
        );
      }
    });
    if (failed)
      throw new ServiceUnavailableException(
        "Refund was not confirmed; reload the case and retry the same refund action. The case remains open.",
      );
    return this.detail(actor, id);
  }

  async reconcile(actor: CaseActor, id: string, body: AfterSalesVersionDto) {
    assertOperator(actor);
    const raw = caseObject(body, ['version']);
    const reference = await reservationTransaction(this.prisma, async tx => {
      const row = await this.lockCase(tx, actor, id);
      assertVersion(row.version, raw.version);
      this.handler(row, actor);
      assertActive(row);
      if (row.booking.paymentMode === "PAY_AT_STORE")
        throw new ConflictException("Pay-at-store refunds are verified from booking settlement");
      if (row.type !== 'REFUND' || !row.refundKey) throw new ConflictException('This case has no original refund request to reconcile');
      return row.bookingId.toString();
    });
    // This action only queries original server IDs. Unknown IDs stay fenced and
    // require the existing original-key refund action; no replacement is sent.
    const checked = await this.payments.reconcileBooking(reference, actor.id, actor.role);
    await reservationTransaction(this.prisma, async tx => {
      let row = await this.lockCase(tx, actor, id);
      this.handler(row, actor);
      row = await this.reconcileRefund(tx, actor, row);
      await this.event(tx, actor, row, 'REFUND_CHECKED', checked.checked ? 'Original payment channel checked. Pending or unknown results remain unresolved.' : 'Local test records checked; no external channel was contacted.', 'INTERNAL');
    });
    return this.detail(actor, id);
  }
}
