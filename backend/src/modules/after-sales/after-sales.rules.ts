import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import {
  CASE_ACTIONS,
  CASE_STATUSES,
  CASE_TYPES,
  CaseAction,
  CaseActor,
} from "./after-sales.dto";

export const ACTIVE_CASE_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"];
export function caseId(value: unknown): bigint {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new BadRequestException("Invalid after-sales resource ID");
  return BigInt(value);
}
export function caseObject(
  value: unknown,
  allowed: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new BadRequestException("Unsupported after-sales request fields");
  return value as Record<string, unknown>;
}
export function caseText(
  value: unknown,
  field: string,
  required = true,
): string {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.trim().length > 2000 ||
    (required && !value.trim()) ||
    /\u0000/.test(value)
  )
    throw new BadRequestException(
      `${field} must contain ${required ? "1–2000" : "at most 2000"} characters`,
    );
  return value.trim();
}
export function versionNumber(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483646
  )
    throw new BadRequestException("A valid current version is required");
  return value;
}
export function assertVersion(actual: number, expected: unknown) {
  if (actual !== versionNumber(expected))
    throw new ConflictException(
      "Case changed; reload before repeating this action",
    );
}
export function assertActor(actor: CaseActor) {
  caseId(actor?.id);
  if (!["ADMIN", "MERCHANT", "CUSTOMER"].includes(actor.role))
    throw new ForbiddenException("After-sales access is unavailable");
}
export function assertOperator(actor: CaseActor) {
  assertActor(actor);
  if (!["ADMIN", "MERCHANT"].includes(actor.role))
    throw new ForbiddenException(
      "Only the platform or owning merchant can process a case",
    );
}
export function assertActive(row: { status: string }) {
  if (!ACTIVE_CASE_STATUSES.includes(row.status))
    throw new ConflictException("Closed cases cannot be changed");
}
export function assertNoUnsettledRefund(row: { refundState: string }) {
  if (["IN_FLIGHT", "PENDING", "RETRYABLE"].includes(row.refundState))
    throw new ConflictException(
      "Reconcile the existing refund before closing or withdrawing this case",
    );
}
export function requestedAmount(
  type: unknown,
  value: unknown,
  paid: number,
  refunded: number,
): number | null {
  if (!CASE_TYPES.includes(type as any))
    throw new BadRequestException("Invalid case type");
  if (type !== "REFUND") {
    if (value !== undefined)
      throw new BadRequestException(
        "Only refund cases accept a requested amount",
      );
    return null;
  }
  if (
    !Number.isSafeInteger(paid) ||
    !Number.isSafeInteger(refunded) ||
    paid < 0 ||
    refunded < 0 ||
    refunded > paid
  )
    throw new ConflictException(
      "Booking payment amounts require reconciliation",
    );
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 99999999 ||
    value > paid - refunded
  )
    throw new BadRequestException(
      "Requested refund must be positive integer cents within the remaining paid amount",
    );
  return value;
}
export function listQuery(value: unknown) {
  const raw = caseObject(value, [
    "page",
    "pageSize",
    "shopId",
    "bookingId",
    "bookingNo",
    "status",
    "type",
  ]);
  const integer = (input: unknown, fallback: number, max: number) => {
    const n =
      typeof input === "string" && /^\d+$/.test(input) ? Number(input) : input;
    if (input === undefined) return fallback;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > max)
      throw new BadRequestException("Invalid pagination");
    return n;
  };
  if (
    (raw.status !== undefined && !CASE_STATUSES.includes(raw.status as any)) ||
    (raw.type !== undefined && !CASE_TYPES.includes(raw.type as any))
  )
    throw new BadRequestException("Invalid case filter");
  if (raw.bookingNo !== undefined && (typeof raw.bookingNo !== "string"
    || !raw.bookingNo.trim() || raw.bookingNo.trim().length > 30
    || /[\u0000-\u001f\u007f]/.test(raw.bookingNo)))
    throw new BadRequestException("A complete booking number of 1–30 characters is required");
  return {
    page: integer(raw.page, 1, 1000000),
    pageSize: integer(raw.pageSize, 25, 100),
    ...(raw.shopId !== undefined ? { shopId: caseId(raw.shopId) } : {}),
    ...(raw.bookingId !== undefined
      ? { bookingId: caseId(raw.bookingId) }
      : {}),
    ...(raw.bookingNo !== undefined ? { bookingNo: (raw.bookingNo as string).trim() } : {}),
    ...(raw.status !== undefined ? { status: raw.status as string } : {}),
    ...(raw.type !== undefined ? { type: raw.type as string } : {}),
  };
}
export function transitionTarget(
  row: {
    status: string;
    acceptedAt: Date | null;
    type: string;
    refundState: string;
    offlineRefundRecordedCents?: number | null;
  },
  action: unknown,
  actor: CaseActor,
): { status: string; reasonRequired: boolean } {
  assertActor(actor);
  assertActive(row);
  if (!CASE_ACTIONS.includes(action as CaseAction))
    throw new BadRequestException("Unknown case action");
  if (action === "WITHDRAW") {
    if (actor.role !== "CUSTOMER")
      throw new ForbiddenException("Only the applicant may withdraw");
    assertNoUnsettledRefund(row);
    if (row.refundState === "SUCCEEDED")
      throw new ConflictException(
        "A refunded case must be resolved by its handler",
      );
    return { status: "WITHDRAWN", reasonRequired: false };
  }
  assertOperator(actor);
  if (action === "ACCEPT") {
    if (row.acceptedAt || row.status === "WAITING_CUSTOMER")
      throw new ConflictException(
        "Case has already been accepted or is waiting for the customer",
      );
    return { status: "IN_PROGRESS", reasonRequired: false };
  }
  if (action === "WAIT_FOR_CUSTOMER") {
    if (!row.acceptedAt || row.status !== "IN_PROGRESS")
      throw new ConflictException(
        "Only an accepted case in progress can wait for the customer",
      );
    return { status: "WAITING_CUSTOMER", reasonRequired: true };
  }
  if (action === "RESUME") {
    if (row.status !== "WAITING_CUSTOMER")
      throw new ConflictException("Case is not waiting for the customer");
    return { status: "IN_PROGRESS", reasonRequired: false };
  }
  if (
    action === "RESOLVE" &&
    row.acceptedAt &&
    row.type === "REFUND" &&
    row.offlineRefundRecordedCents === null
  )
    throw new ConflictException(
      "Verify the recorded offline refund in booking settlement before closing this case",
    );
  assertNoUnsettledRefund(row);
  if (action === "REJECT") {
    if (row.refundState === "SUCCEEDED")
      throw new ConflictException("A successful refund cannot be rejected");
    return { status: "REJECTED", reasonRequired: true };
  }
  if (!row.acceptedAt)
    throw new ConflictException("Accept this case before resolving it");
  if (row.type === "REFUND" && row.refundState !== "SUCCEEDED")
    throw new ConflictException(
      "A refund case cannot be resolved before the refund succeeds",
    );
  return { status: "RESOLVED", reasonRequired: true };
}
