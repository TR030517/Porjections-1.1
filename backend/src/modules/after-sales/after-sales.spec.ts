import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PaymentService } from "../payment/payment.service";
import { AfterSalesService } from "./after-sales.service";
import {
  AfterSalesNoteDto,
  AfterSalesListDto,
  AfterSalesTransitionDto,
  CreateAfterSalesDto,
} from "./after-sales.dto";
import {
  assertVersion,
  caseId,
  caseObject,
  caseText,
  listQuery,
  requestedAmount,
  transitionTarget,
} from "./after-sales.rules";

const customer = { id: "3", role: "CUSTOMER" },
  merchant = { id: "2", role: "MERCHANT" },
  admin = { id: "1", role: "ADMIN" };
const now = new Date("2030-01-01T00:00:00Z");
const booking = {
  id: 7n,
  userId: 3n,
  shopId: 5n,
  bookingNo: "SYNTHETIC-7",
  status: "CONFIRMED",
  paymentMode: "ONLINE",
  paymentStatus: "PAID",
  paidCents: 12000,
  refundedCents: 0,
  currency: "usd",
  startTime: new Date("2030-02-01T18:00:00Z"),
  endTime: new Date("2030-02-01T19:00:00Z"),
  bookingTimezone: "America/Los_Angeles",
  deletedAt: null,
  shop: { id: 5n, ownerId: 8n, name: "Synthetic local shop", deletedAt: null, loginBinding: { shopId: 5n, userId: 2n } },
  service: { name: "Synthetic service" },
  paymentId: "must-not-be-projected",
  user: { phone: "must-not-be-projected", email: "must-not-be-projected" },
};
const initial = {
  id: 10n,
  bookingId: 7n,
  shopId: 5n,
  customerId: 3n,
  activeBookingId: 7n,
  type: "COMPLAINT",
  status: "OPEN",
  reason: "Synthetic complaint",
  requestedAmountCents: null,
  currency: "usd",
  assignedToId: null,
  acceptedAt: null,
  version: 1,
  refundKey: null,
  refundState: "NONE",
  refundRequestId: null,
  createdAt: now,
  updatedAt: now,
  closedAt: null,
};

/** A staged in-memory transaction tests composition/rollback and explicit
 * optimistic guards. It does not claim to prove MySQL locking or HTTP auth. */
function fixture(
  options: {
    empty?: boolean;
    row?: Record<string, unknown>;
    auditFailure?: boolean;
    providerEnabled?: boolean;
    providerFails?: boolean;
    providerPending?: boolean;
  } = {},
) {
  let committed = {
    row: options.empty ? null : { ...structuredClone(initial), ...options.row },
    booking: structuredClone(booking),
    events: [] as any[],
    audits: [] as any[],
    refunds: [] as any[],
    users: [
      { id: 1n, role: "ADMIN", status: "ACTIVE", deletedAt: null },
      { id: 2n, role: "MERCHANT", status: "ACTIVE", deletedAt: null },
      { id: 3n, role: "CUSTOMER", status: "ACTIVE", deletedAt: null },
      { id: 8n, role: "MERCHANT", status: "ACTIVE", deletedAt: null },
      { id: 9n, role: "MERCHANT", status: "ACTIVE", deletedAt: null },
    ],
  };
  let activeTransaction = false;
  const userScope = (where: any, user: any) => !!user && Object.entries(where).every(([key, value]) => value === undefined || user[key] === value);
  const shopScope = (where: any, s: any) => {
    if (!where) return true;
    const shop = s.booking.shop, expected = where.loginBinding?.is ?? where.loginBinding;
    return (where.id === undefined || where.id === shop.id)
      && (where.deletedAt === undefined || where.deletedAt === shop.deletedAt)
      && (!expected || !!shop.loginBinding
        && (expected.userId === undefined || expected.userId === shop.loginBinding.userId)
        && (!expected.user || userScope(expected.user, s.users.find((user: any) => user.id === shop.loginBinding.userId))));
  };
  const scope = (where: any, s: any) =>
    !!s.row &&
    (!where.id || s.row.id === where.id) &&
    (!where.customerId || s.row.customerId === where.customerId) &&
    shopScope(where.shop, s) &&
    (!where.shopId || s.row.shopId === where.shopId) &&
    (!where.bookingId || s.row.bookingId === where.bookingId) &&
    (!where.booking?.bookingNo || s.booking.bookingNo === where.booking.bookingNo) &&
    (!where.status ||
      (typeof where.status === "string" && s.row.status === where.status) ||
      where.status?.in?.includes(s.row.status));
  const model = (s: any) => {
    const withBooking = () => (s.row ? { ...s.row, booking: s.booking } : null);
    const eventRows = (where: any) =>
      s.events.filter(
        (event: any) =>
          event.caseId === where.caseId &&
          (!where.visibility || event.visibility === where.visibility),
      );
    return {
      $queryRaw: jest.fn(async () => [{ id: 5n }]),
      user: {
        findFirst: jest.fn(async ({ where }: any) => s.users.find((user: any) => userScope(where, user)) ?? null),
      },
      shop: {
        findFirst: jest.fn(async ({ where }: any) => shopScope(where, s) ? {
          ...s.booking.shop,
          owner: s.users.find((user: any) => user.id === s.booking.shop.ownerId),
          loginBinding: { ...s.booking.shop.loginBinding, user: s.users.find((user: any) => user.id === s.booking.shop.loginBinding.userId) },
        } : null),
      },
      shopAccountGrant: { findFirst: jest.fn(async () => null) },
      booking: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === s.booking.id ? s.booking : null,
        ),
        findUniqueOrThrow: jest.fn(async () => s.booking),
      },
      afterSalesCase: {
        findFirst: jest.fn(async ({ where }: any) =>
          scope(where, s) ? withBooking() : null,
        ),
        findUnique: jest.fn(async ({ where }: any) =>
          s.row?.id === where.id ? withBooking() : null,
        ),
        findUniqueOrThrow: jest.fn(async () => withBooking()),
        findMany: jest.fn(async ({ where }: any) =>
          scope(where, s) ? [withBooking()] : [],
        ),
        count: jest.fn(async ({ where }: any) => (scope(where, s) ? 1 : 0)),
        create: jest.fn(async ({ data }: any) => {
          s.row = { ...structuredClone(initial), ...data };
          return withBooking();
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (
            !s.row ||
            s.row.id !== where.id ||
            s.row.version !== where.version
          )
            return { count: 0 };
          s.row = {
            ...s.row,
            ...data,
            version: s.row.version + (data.version?.increment ?? 0),
          };
          return { count: 1 };
        }),
      },
      afterSalesEvent: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: BigInt(s.events.length + 1),
            ...data,
            createdAt: now,
            actor: { role: data.actorId === 3n ? "CUSTOMER" : "MERCHANT" },
          };
          s.events.push(row);
          return row;
        }),
        findMany: jest.fn(async ({ where, orderBy, take, skip = 0 }: any) => {
          const rows = eventRows(where);
          if (orderBy.id === "desc") rows.reverse();
          return rows.slice(skip, skip + take);
        }),
        count: jest.fn(async ({ where }: any) => eventRows(where).length),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => {
          if (options.auditFailure) throw Error("Synthetic audit unavailable");
          s.audits.push(data);
          return data;
        }),
      },
      refundRequest: {
        findUnique: jest.fn(
          async ({ where }: any) =>
            s.refunds.find((row: any) =>
              where.id
                ? row.id === where.id
                : row.idempotencyKey === where.idempotencyKey,
            ) ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) =>
          s.refunds.filter((row: any) =>
            where.idempotencyKey.in.includes(row.idempotencyKey),
          ),
        ),
      },
    };
  };
  const prisma: any = {};
  for (const key of ["afterSalesCase", "afterSalesEvent", "refundRequest", "user", "shop", "shopAccountGrant"])
    Object.defineProperty(prisma, key, {
      get: () => model(committed)[key as keyof ReturnType<typeof model>],
    });
  prisma.$transaction = jest.fn(async (callback: any, options: any) => {
    expect(options.isolationLevel).toBe("ReadCommitted");
    const staged = structuredClone(committed);
    activeTransaction = true;
    try {
      const result = await callback(model(staged));
      committed = staged;
      return result;
    } finally {
      activeTransaction = false;
    }
  });
  const payments: any = {
    isRefundProviderAvailable: jest.fn(() => options.providerEnabled !== false),
    reconcileBooking: jest.fn(async () => {
      expect(activeTransaction).toBe(false);
      if (options.providerEnabled === false || options.providerFails) throw new ServiceUnavailableException('Synthetic channel unavailable');
      return { checked: true };
    }),
    refundBooking: jest.fn(
      async (
        _booking: string,
        _actor: string,
        _role: string,
        amount: number,
        key: string,
      ) => {
        expect(activeTransaction).toBe(false);
        if (options.providerFails)
          throw Error("Synthetic timeout; no payment credentials");
        let record = committed.refunds.find(
          (row) => row.idempotencyKey === key,
        );
        if (!record) {
          record = {
            id: "synthetic-refund",
            bookingId: 7n,
            amountCents: amount,
            idempotencyKey: key,
            status: options.providerPending ? "PENDING" : "SUCCEEDED",
          };
          committed.refunds.push(record);
        }
        return {
          status: record.status,
          requestId: record.id,
          refundId: "never-project-provider-id",
        };
      },
    ),
  };
  return {
    service: new AfterSalesService(prisma, payments),
    prisma,
    payments,
    state: () => structuredClone(committed),
    mutate: (change: (data: typeof committed) => void) => change(committed),
    setRefundStatus: (status: string) => {
      committed.refunds[0].status = status;
    },
  };
}

describe("after-sales request and state validation", () => {
  test.each(["0", "01", "-1", "1.5", "9223372036854775808", 1, null])(
    "rejects malformed or unsafe ID %p",
    (value) => expect(() => caseId(value)).toThrow(BadRequestException),
  );
  test("preserves signed BigInt maximum and validates integer-cent remaining allowance", () => {
    expect(caseId("9223372036854775807")).toBe(9223372036854775807n);
    expect(requestedAmount("REFUND", 125, 500, 375)).toBe(125);
    for (const value of [0, -1, 1.5, 126, null, undefined, "125"])
      expect(() => requestedAmount("REFUND", value, 500, 375)).toThrow(
        BadRequestException,
      );
    expect(() => requestedAmount("OTHER", 1, 500, 0)).toThrow(
      BadRequestException,
    );
    expect(requestedAmount("OTHER", undefined, 0, 0)).toBeNull();
  });
  test("rejects injection, whitespace-only notes, stale versions and unbounded pagination", () => {
    expect(() =>
      caseObject({ version: 1, customer: { role: "ADMIN" } }, ["version"]),
    ).toThrow(BadRequestException);
    expect(() => caseText("   ", "Note")).toThrow(BadRequestException);
    expect(() => assertVersion(2, 1)).toThrow(ConflictException);
    expect(() => listQuery({ pageSize: 101 })).toThrow(BadRequestException);
    expect(() => listQuery({ status: "ALL" })).toThrow(BadRequestException);
    expect(
      listQuery({ page: "2", pageSize: "10", shopId: "9007199254740993" }),
    ).toMatchObject({ page: 2, pageSize: 10, shopId: 9007199254740993n });
  });
  test("DTO whitelist rejects unknown nested fields rather than handing them to Prisma", async () => {
    for (const [Type, body] of [
      [
        CreateAfterSalesDto,
        { bookingId: "7", type: "OTHER", reason: "Example", customerId: "9" },
      ],
      [
        AfterSalesNoteDto,
        { version: 1, content: "Example", actor: { role: "ADMIN" } },
      ],
      [
        AfterSalesTransitionDto,
        { version: 1, action: "RESOLVE", refundState: "SUCCEEDED" },
      ],
    ] as const) {
      expect(
        (
          await validate(plainToInstance(Type as any, body), {
            whitelist: true,
            forbidNonWhitelisted: true,
          })
        ).length,
      ).toBeGreaterThan(0);
    }
  });
  test("complete displayed booking numbers pass DTO and query normalization while internal IDs remain independent", async () => {
    const bookingNo = 'MJ0123456789abcdef012345678';
    const dto = plainToInstance(AfterSalesListDto, { bookingNo: ` ${bookingNo} `, bookingId: '7', shopId: '5' });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(listQuery(dto)).toMatchObject({ bookingNo, bookingId: 7n, shopId: 5n, page: 1 });
    for (const bad of ['', '   ', 'x'.repeat(31), 'MJ\u0000bad', ['MJ1'], { contains: 'MJ' }, 7]) {
      expect(() => listQuery({ bookingNo: bad })).toThrow(BadRequestException);
      expect((await validate(plainToInstance(AfterSalesListDto, { bookingNo: bad }))).length).toBeGreaterThan(0);
    }
  });
  test("money in flight cannot be closed or withdrawn and refunds cannot be faked as resolved", () => {
    for (const refundState of ["IN_FLIGHT", "PENDING", "RETRYABLE"]) {
      expect(() =>
        transitionTarget({ ...initial, refundState }, "WITHDRAW", customer),
      ).toThrow(ConflictException);
      expect(() =>
        transitionTarget({ ...initial, refundState }, "REJECT", merchant),
      ).toThrow(ConflictException);
    }
    expect(() =>
      transitionTarget(
        { ...initial, type: "REFUND", acceptedAt: now },
        "RESOLVE",
        merchant,
      ),
    ).toThrow(ConflictException);
    expect(() => transitionTarget(initial, "WITHDRAW", merchant)).toThrow(
      ForbiddenException,
    );
  });
});

describe("after-sales persisted workflow and safe projections", () => {
  test("new cases use JWT identity, authoritative booking amounts, one active booking and atomic timeline/audit", async () => {
    const f = fixture({ empty: true });
    const result = await f.service.create(customer, {
      bookingId: "7",
      type: "REFUND",
      reason: " Please review ",
      requestedAmountCents: 6000,
    });
    expect(result).toMatchObject({
      status: "OPEN",
      version: 1,
      requestedAmountCents: 6000,
      currency: "usd",
    });
    expect(f.state().row).toMatchObject({
      customerId: 3n,
      shopId: 5n,
      activeBookingId: 7n,
      reason: "Please review",
    });
    expect(f.state().events).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1);
    await expect(
      f.service.create(customer, {
        bookingId: "7",
        type: "OTHER",
        reason: "Duplicate",
      }),
    ).rejects.toThrow(ConflictException);
  });
  test("customer cannot submit another user booking or act as operator; merchant cannot read another shop", async () => {
    const f = fixture({ empty: true });
    await expect(
      f.service.create(
        { ...customer, id: "4" },
        { bookingId: "7", type: "OTHER", reason: "Example" },
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      f.service.create(merchant, {
        bookingId: "7",
        type: "OTHER",
        reason: "Example",
      }),
    ).rejects.toThrow(ForbiddenException);
    const existing = fixture();
    await expect(
      existing.service.detail({ ...merchant, id: "9" }, "10"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      existing.service.claim(customer, "10", { version: 1 }),
    ).rejects.toThrow(ForbiddenException);
  });
  test("claim and explicit acceptance retain versions; public request/reply resumes processing", async () => {
    const f = fixture();
    const claimed = await f.service.claim(merchant, "10", { version: 1 });
    expect(claimed).toMatchObject({
      status: "IN_PROGRESS",
      version: 2,
      assignedToId: "2",
      acceptedAt: null,
    });
    expect(claimed.allowedActions).toContain("ACCEPT");
    expect(claimed.allowedActions).not.toContain("WAIT_FOR_CUSTOMER");
    const beforeWaiting = f.state();
    await expect(
      f.service.transition(merchant, "10", {
        version: claimed.version,
        action: "WAIT_FOR_CUSTOMER",
        reason: "Please provide a public clarification",
      }),
    ).rejects.toThrow(ConflictException);
    expect(f.state()).toEqual(beforeWaiting);
    await expect(
      f.service.transition(merchant, "10", { version: 1, action: "ACCEPT" }),
    ).rejects.toThrow(ConflictException);
    const accepted = await f.service.transition(merchant, "10", {
      version: 2,
      action: "ACCEPT",
    });
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect(accepted.allowedActions).toContain("WAIT_FOR_CUSTOMER");
    const waiting = await f.service.transition(merchant, "10", {
      version: accepted.version,
      action: "WAIT_FOR_CUSTOMER",
      reason: "Please provide a public clarification",
    });
    expect(waiting.status).toBe("WAITING_CUSTOMER");
    const replied = await f.service.note(customer, "10", {
      version: waiting.version,
      content: "Public clarification",
    });
    expect(replied.status).toBe("IN_PROGRESS");
    const resolved = await f.service.transition(merchant, "10", {
      version: replied.version,
      action: "RESOLVE",
      reason: "Handled with the customer",
    });
    expect(resolved.status).toBe("RESOLVED");
    expect(f.state().row!.activeBookingId).toBeNull();
    await expect(
      f.service.note(merchant, "10", {
        version: resolved.version,
        content: "Late note",
      }),
    ).rejects.toThrow(ConflictException);
  });
  test("a legacy case waiting without acceptance can resume and be accepted", async () => {
    const f = fixture({ row: { status: "WAITING_CUSTOMER", assignedToId: 2n } });
    const waiting = await f.service.detail(merchant, "10");
    expect(waiting.allowedActions).toContain("RESUME");
    expect(waiting.allowedActions).not.toContain("ACCEPT");

    const resumed = await f.service.transition(merchant, "10", {
      version: waiting.version,
      action: "RESUME",
    });
    expect(resumed).toMatchObject({ status: "IN_PROGRESS", acceptedAt: null });
    expect(resumed.allowedActions).toContain("ACCEPT");
    expect(resumed.allowedActions).not.toContain("WAIT_FOR_CUSTOMER");

    const accepted = await f.service.transition(merchant, "10", {
      version: resumed.version,
      action: "ACCEPT",
    });
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect(accepted.allowedActions).toContain("WAIT_FOR_CUSTOMER");
  });
  test("customers never receive internal timeline entries, counts, actor identity or payment/account fields", async () => {
    const f = fixture();
    await f.service.note(merchant, "10", {
      version: 1,
      content: "PRIVATE-INTERNAL-CONTENT",
      visibility: "INTERNAL",
    });
    const result = await f.service.detail(customer, "10");
    expect(result.timeline).toEqual([]);
    expect(result.timelineTotal).toBe(0);
    const publicResult = JSON.stringify(result);
    for (const text of [
      "PRIVATE-INTERNAL-CONTENT",
      "must-not-be-projected",
      "paymentId",
      "refundKey",
      "refundRequestId",
      "email",
      "phone",
      "customerId",
      "assignedToId",
    ])
      expect(publicResult).not.toContain(text);
    await expect(
      f.service.note(customer, "10", {
        version: 2,
        content: "Try internal",
        visibility: "INTERNAL",
      }),
    ).rejects.toThrow(ForbiddenException);
    expect((await f.service.detail(merchant, "10")).timeline[0].content).toBe(
      "PRIVATE-INTERNAL-CONTENT",
    );
  });
  test("merchant login binding scoping applies to list filters and timeline pagination", async () => {
    const f = fixture();
    expect((await f.service.list({ ...merchant, id: "9" }, {})).total).toBe(0);
    await expect(
      f.service.events({ ...customer, id: "4" }, "10", {
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow(NotFoundException);
  });
  test("displayed booking number filters both rows and totals by exact match, without interpreting it as an internal ID", async () => {
    const f = fixture();
    f.mutate(data => { data.booking.bookingNo = 'MJ0123456789abcdef012345678'; });
    const query = { bookingNo: 'MJ0123456789abcdef012345678', shopId: '5' };
    const match = await f.service.list(merchant, query);
    expect(match.total).toBe(1);
    expect(match.items[0].booking.bookingNo).toBe(query.bookingNo);
    for (const bookingNo of ['MJ0123456789', '7', 'no-such-booking']) {
      expect(await f.service.list(merchant, { ...query, bookingNo })).toMatchObject({ items: [], total: 0 });
    }
    expect((await f.service.list(merchant, { bookingId: '7' })).total).toBe(1);
    expect((await f.service.list(merchant, { ...query, bookingId: '8' })).total).toBe(0);
  });
  test("booking number lookup cannot bypass the selected shop, merchant binding or customer ownership", async () => {
    const f = fixture(), query = { bookingNo: booking.bookingNo };
    expect((await f.service.list(customer, query)).total).toBe(1);
    for (const actor of [{ id: '9', role: 'MERCHANT' }, { id: '4', role: 'CUSTOMER' }]) {
      expect(await f.service.list(actor, query)).toMatchObject({ items: [], total: 0 });
    }
    expect(await f.service.list(merchant, { ...query, shopId: '6' })).toMatchObject({ items: [], total: 0 });
  });
  test("a bound account handles the historical owner's case while unbound or disabled accounts cannot", async () => {
    const f = fixture();
    expect((await f.service.list(merchant, {})).total).toBe(1);
    await expect(f.service.detail({ id: "8", role: "MERCHANT" }, "10")).rejects.toThrow(NotFoundException);
    f.mutate(data => { data.users.find(user => user.id === 8n)!.status = "SUSPENDED"; });
    await expect(f.service.claim(merchant, "10", { version: 1 })).resolves.toMatchObject({ assignedToId: "2", version: 2 });
    expect(f.state().booking.shop.ownerId).toBe(8n);
    f.mutate(data => { data.users.find(user => user.id === 2n)!.status = "SUSPENDED"; });
    expect((await f.service.list(merchant, {})).total).toBe(0);
    await expect(f.service.detail(merchant, "10")).rejects.toThrow(NotFoundException);
    expect(f.state().row!.version).toBe(2);
    expect(f.state().events).toHaveLength(1);
    expect(f.state().audits).toHaveLength(1);
  });
  test("failed audit rolls back mutation and timeline with it", async () => {
    const f = fixture({ auditFailure: true });
    await expect(
      f.service.claim(merchant, "10", { version: 1 }),
    ).rejects.toThrow("Synthetic audit unavailable");
    expect(f.state().row!.version).toBe(1);
    expect(f.state().row!.assignedToId).toBeNull();
    expect(f.state().events).toHaveLength(0);
  });
  test("reject and resolve require public reasons; withdrawal is customer-only and releases the active gate", async () => {
    const f = fixture();
    await expect(
      f.service.transition(admin, "10", {
        version: 1,
        action: "REJECT",
        reason: "  ",
      }),
    ).rejects.toThrow(BadRequestException);
    const withdrawn = await f.service.transition(customer, "10", {
      version: 1,
      action: "WITHDRAW",
    });
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(f.state().row!.activeBookingId).toBeNull();
    await expect(
      f.service.transition(admin, "10", {
        version: withdrawn.version,
        action: "REJECT",
        reason: "Too late",
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe("after-sales explicit refund action", () => {
  const refundCase = {
    type: "REFUND",
    requestedAmountCents: 6000,
    status: "IN_PROGRESS",
    acceptedAt: now,
    assignedToId: 2n,
  };
  test("disabled configuration never creates an intent or calls the provider", async () => {
    const f = fixture({ row: refundCase, providerEnabled: false });
    const before = f.state();
    await expect(
      f.service.refund(merchant, "10", { version: 1 }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(f.payments.refundBooking).not.toHaveBeenCalled();
    expect(f.state()).toEqual(before);
  });
  test("pay-at-store refunds point to booking settlement even when the online provider is disabled", async () => {
    const f = fixture({ row: refundCase, providerEnabled: false });
    f.mutate(({ booking }) => {
      booking.paymentMode = "PAY_AT_STORE";
    });
    const before = f.state();
    await expect(
      f.service.refund(merchant, "10", { version: 1 }),
    ).rejects.toThrow("Pay-at-store refunds must be recorded in booking settlement");
    expect(f.payments.isRefundProviderAvailable).not.toHaveBeenCalled();
    expect(f.payments.refundBooking).not.toHaveBeenCalled();
    expect(f.state()).toEqual(before);
  });
  test("an available provider can refund an existing payment while new checkout is closed", async () => {
    const env = jest.replaceProperty(process, "env", {
      ...process.env,
      NODE_ENV: "test",
      PAYMENT_PROVIDER: "local_mock",
      BOOKING_ONLINE_PAYMENT_ENABLED: "false",
    });
    try {
      const f = fixture({ row: refundCase });
      const payments = new PaymentService(f.prisma);
      const refund = jest
        .spyOn(payments, "refundBooking")
        .mockImplementation(f.payments.refundBooking);
      const service = new AfterSalesService(f.prisma, payments);

      expect(payments.config().enabled).toBe(false);
      await expect(
        service.refund(merchant, "10", { version: 1 }),
      ).resolves.toMatchObject({
        status: "IN_PROGRESS",
        refundState: "SUCCEEDED",
      });
      expect(refund).toHaveBeenCalledWith(
        "7", "2", "MERCHANT", 6000, "after-sales:10:refund",
      );
    } finally {
      env.restore();
    }
  });
  test("the payment call is outside the transaction, uses a stable server key and does not automatically close the case", async () => {
    const f = fixture({ row: refundCase });
    const paid = await f.service.refund(merchant, "10", { version: 1 });
    expect(f.payments.refundBooking).toHaveBeenCalledWith(
      "7",
      "2",
      "MERCHANT",
      6000,
      "after-sales:10:refund",
    );
    expect(paid).toMatchObject({
      status: "IN_PROGRESS",
      refundState: "SUCCEEDED",
    });
    expect(JSON.stringify(paid)).not.toContain("never-project-provider-id");
    const resolved = await f.service.transition(merchant, "10", {
      version: paid.version,
      action: "RESOLVE",
      reason: "The requested refund was confirmed",
    });
    expect(resolved.status).toBe("RESOLVED");
  });
  test("a timeout without a request remains fenced and a later retry reuses the original key", async () => {
    const f = fixture({ row: refundCase, providerFails: true });
    await expect(
      f.service.refund(merchant, "10", { version: 1 }),
    ).rejects.toThrow(ServiceUnavailableException);
    const state = f.state().row!;
    expect(state.refundState).toBe("RETRYABLE");
    expect(state.status).toBe("IN_PROGRESS");
    await expect(
      f.service.transition(customer, "10", {
        version: state.version,
        action: "WITHDRAW",
      }),
    ).rejects.toThrow(ConflictException);
    await expect(
      f.service.refund(merchant, "10", { version: state.version }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(
      f.payments.refundBooking.mock.calls.map((call: any[]) => call[4]),
    ).toEqual(["after-sales:10:refund", "after-sales:10:refund"]);
  });
  test("pending provider outcome cannot resolve; authoritative later success can be reconciled before closure", async () => {
    const f = fixture({ row: refundCase, providerPending: true });
    const pending = await f.service.refund(merchant, "10", { version: 1 });
    expect(pending.refundState).toBe("PENDING");
    await expect(
      f.service.transition(merchant, "10", {
        version: pending.version,
        action: "RESOLVE",
        reason: "Not actually refunded",
      }),
    ).rejects.toThrow(ConflictException);
    f.setRefundStatus("SUCCEEDED");
    const fresh = await f.service.detail(merchant, "10");
    expect(fresh.refundState).toBe("SUCCEEDED");
    expect(fresh.allowedActions).toContain("RESOLVE");
    expect(fresh.version).toBe(pending.version);
    const closed = await f.service.transition(merchant, "10", {
      version: pending.version,
      action: "RESOLVE",
      reason: "Refund independently confirmed",
    });
    expect(closed).toMatchObject({
      status: "RESOLVED",
      refundState: "SUCCEEDED",
    });
  });
  test('controlled recheck queries the server outside locks and records the actual operator without closing the case', async () => {
    const f = fixture({ row: refundCase, providerPending: true });
    const pending = await f.service.refund(merchant, '10', { version: 1 });
    f.setRefundStatus('SUCCEEDED');
    const result = await f.service.reconcile(merchant, '10', { version: pending.version });
    expect(f.payments.reconcileBooking).toHaveBeenCalledWith('7', '2', 'MERCHANT');
    expect(result).toMatchObject({ status: 'IN_PROGRESS', refundState: 'SUCCEEDED' });
    expect(f.state().events.at(-1)).toMatchObject({ actorId: 2n, kind: 'REFUND_CHECKED', visibility: 'INTERNAL' });
    expect(f.payments.refundBooking).toHaveBeenCalledTimes(1);
  });
  test('customer, stale version and no-original-refund cases never query the channel', async () => {
    const f = fixture({ row: refundCase });
    await expect(f.service.reconcile(customer, '10', { version: 1 })).rejects.toThrow(ForbiddenException);
    await expect(f.service.reconcile(merchant, '10', { version: 2 })).rejects.toThrow(ConflictException);
    await expect(f.service.reconcile(merchant, '10', { version: 1 })).rejects.toThrow(ConflictException);
    expect(f.payments.reconcileBooking).not.toHaveBeenCalled();
  });
  test('channel recheck failure leaves the original pending fence and human case status intact', async () => {
    const f = fixture({ row: { ...refundCase, refundKey: 'after-sales:10:refund', refundState: 'RETRYABLE' }, providerFails: true });
    await expect(f.service.reconcile(merchant, '10', { version: 1 })).rejects.toThrow(ServiceUnavailableException);
    expect(f.state().row).toMatchObject({ version: 1, refundState: 'RETRYABLE', status: 'IN_PROGRESS' });
    expect(f.state().events).toHaveLength(0); expect(f.payments.refundBooking).not.toHaveBeenCalled();
  });
});
