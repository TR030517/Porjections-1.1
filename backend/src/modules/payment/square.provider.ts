import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Square's documented REST contract, pinned rather than following account defaults.
// https://developer.squareup.com/reference/square/checkout-api/create-payment-link
export const SQUARE_API_VERSION = "2026-09-16";
type SquareEnvironment = "sandbox" | "production";
type JsonObject = Record<string, unknown>;
export type SquareTransport = typeof fetch;

export interface SquareConfiguration {
  enabled: boolean;
  provider: "square";
  environment?: SquareEnvironment;
  currency?: string;
  shopId?: string;
  reason?: string;
}

export interface SquareBinding {
  environment: SquareEnvironment;
  merchantId: string;
  locationId: string;
  shopId: string;
  currency: string;
  configurationHash: string;
}

export interface SquareCheckoutInput {
  /** Stable, persisted server ledger key. Never use a fresh key for a retry. */
  idempotencyKey: string;
  /** Amount and currency must come from the server's persisted quote. */
  amountCents: number;
  currency: string;
  referenceId: string;
  bookingNo?: string;
}

export interface SquareCheckout {
  checkoutId: string;
  checkoutUrl: string;
  orderId: string;
  amountCents: number;
  currency: string;
}

export interface SquareRefundInput {
  idempotencyKey: string;
  paymentId: string;
  amountCents: number;
  currency: string;
  referenceId?: string;
}

export interface SquarePayment {
  id: string;
  orderId: string;
  locationId: string;
  status: "APPROVED" | "PENDING" | "COMPLETED" | "CANCELED" | "FAILED";
  amountCents: number;
  totalCents: number;
  currency: string;
  referenceId?: string;
}

export interface SquareRefund {
  id: string;
  paymentId: string;
  orderId?: string;
  locationId: string;
  status: "PENDING" | "COMPLETED" | "REJECTED" | "FAILED";
  amountCents: number;
  currency: string;
  referenceId?: string;
}

export interface SquareOrder {
  id: string;
  locationId: string;
  referenceId: string;
  amountCents: number;
  currency: string;
  paymentIds: string[];
}

export type SquareWebhookEvent = {
  id: string;
  type: string;
  merchantId: string;
} & (
  | { kind: "payment"; payment: SquarePayment }
  | { kind: "refund"; refund: SquareRefund }
  | { kind: "ignored" }
);

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid Square object");
  }
  return value as JsonObject;
}

function identifier(value: unknown, name: string, max = 192): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    /[\s\x00-\x1f]/.test(value)
  ) {
    throw new BadRequestException(`Invalid Square ${name}`);
  }
  return value;
}

function positiveCents(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 99999999
  ) {
    throw new BadRequestException(
      "Square amount must be positive integer cents",
    );
  }
  return value;
}

function configuredUrl(
  value: string | undefined,
  environment: SquareEnvironment,
): boolean {
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const local =
      environment === "sandbox" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" || (local && url.protocol === "http:"))
    );
  } catch {
    return false;
  }
}

/** No database writes and no Stripe fallback. Only PaymentService may settle the ledger. */
export class SquareProvider {
  private readonly environment?: SquareEnvironment;
  private readonly accessToken?: string;
  private readonly locationId?: string;
  private readonly merchantId?: string;
  private readonly currency?: string;
  private readonly signatureKey?: string;
  private readonly notificationUrl?: string;
  private readonly redirectUrl?: string;
  private readonly timeoutMs: number;
  private readonly state: SquareConfiguration;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    private readonly transport: SquareTransport = fetch,
  ) {
    this.environment =
      env.SQUARE_ENVIRONMENT === "sandbox" ||
      env.SQUARE_ENVIRONMENT === "production"
        ? env.SQUARE_ENVIRONMENT
        : undefined;
    this.accessToken = env.SQUARE_ACCESS_TOKEN;
    this.locationId = env.SQUARE_LOCATION_ID;
    this.merchantId = env.SQUARE_MERCHANT_ID;
    this.currency = env.SQUARE_CURRENCY?.toUpperCase();
    this.signatureKey = env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    this.notificationUrl = env.SQUARE_WEBHOOK_NOTIFICATION_URL;
    this.redirectUrl = env.SQUARE_CHECKOUT_REDIRECT_URL;
    this.timeoutMs = Number(env.SQUARE_TIMEOUT_MS || 10000);
    const fields = [
      this.accessToken,
      this.locationId,
      this.merchantId,
      this.signatureKey,
    ];
    const configured =
      this.environment &&
      typeof env.SQUARE_SHOP_ID === "string" && /^[1-9]\d{0,18}$/.test(env.SQUARE_SHOP_ID) && BigInt(env.SQUARE_SHOP_ID) <= 9223372036854775807n &&
      fields.every(
        (value) =>
          typeof value === "string" &&
          value.trim() === value &&
          value.length > 0,
      ) &&
      /^[A-Z]{3}$/.test(this.currency || "") &&
      configuredUrl(this.notificationUrl, this.environment) &&
      configuredUrl(this.redirectUrl, this.environment) &&
      Number.isInteger(this.timeoutMs) &&
      this.timeoutMs >= 1 &&
      this.timeoutMs <= 60000;
    const enabled =
      env.PAYMENT_PROVIDER === "square" &&
      env.PAYMENT_EXTERNAL_ENABLED === "true" &&
      !!configured;
    this.state = {
      enabled,
      provider: "square",
      environment: this.environment,
      currency: this.currency?.toLowerCase(),
      shopId: configured ? env.SQUARE_SHOP_ID : undefined,
      ...(enabled
        ? {}
        : {
            reason:
              "Square checkout requires explicit enablement and complete server configuration",
          }),
    };
  }

  config(): SquareConfiguration {
    return { ...this.state };
  }

  /** Persisted only in the server ledger. Never return the hash or raw settings to clients. */
  binding(): SquareBinding {
    this.requireEnabled();
    const identity = { environment: this.environment!, merchantId: this.merchantId!, locationId: this.locationId!, shopId: this.state.shopId!, currency: this.currency!.toLowerCase() };
    const configurationHash = createHash('sha256').update(JSON.stringify({ scope:'massajoy:square-binding:v1', ...identity,
      accessToken:this.accessToken, signatureKey:this.signatureKey, notificationUrl:this.notificationUrl, redirectUrl:this.redirectUrl })).digest('hex');
    return { ...identity, configurationHash };
  }

  private requireEnabled(): void {
    if (!this.state.enabled)
      throw new ServiceUnavailableException(this.state.reason);
  }

  private money(
    amountCents: number,
    currency: string,
  ): { amount: number; currency: string } {
    positiveCents(amountCents);
    if (
      typeof currency !== "string" ||
      currency.toUpperCase() !== this.currency
    ) {
      throw new BadRequestException(
        "Square currency must match the configured server currency",
      );
    }
    return { amount: amountCents, currency: this.currency! };
  }

  /** Square refund keys allow at most 45 characters. Domain-separated keys are stable and 40 ASCII characters. */
  private key(operation: "checkout" | "refund", value: string): string {
    identifier(value, "idempotency key", 192);
    return `mj_${createHash("sha256").update(`square:${operation}:${value}`).digest("hex").slice(0, 37)}`;
  }

  private async request(
    path: string,
    payload?: JsonObject,
  ): Promise<JsonObject> {
    this.requireEnabled();
    const origin =
      this.environment === "sandbox"
        ? "https://connect.squareupsandbox.com"
        : "https://connect.squareup.com";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(`${origin}${path}`, {
        method: payload === undefined ? "GET" : "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": SQUARE_API_VERSION,
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      if (!response.ok)
        throw new ServiceUnavailableException(
          "Square rejected the request; reconcile or retry with the same idempotency key",
        );
      const data = object(await response.json());
      if (
        data.errors !== undefined &&
        (!Array.isArray(data.errors) || data.errors.length)
      ) {
        throw new ServiceUnavailableException(
          "Square returned an error; reconcile or retry with the same idempotency key",
        );
      }
      return data;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        "Square request failed, timed out, or returned an invalid response; retry with the same idempotency key",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Official RetrieveOrder/GetPayment/GetPaymentRefund APIs. IDs are persisted server IDs. */
  // https://developer.squareup.com/reference/square/orders-api/retrieve-order
  // https://developer.squareup.com/reference/square/payments-api/get-payment
  // https://developer.squareup.com/reference/square/refunds-api/get-payment-refund
  async getOrder(id: string): Promise<SquareOrder> {
    const expected = identifier(id, "order ID");
    const data = await this.request(`/v2/orders/${encodeURIComponent(expected)}`);
    const order = object(data.order);
    if (order.id !== expected || order.location_id !== this.locationId) throw new BadRequestException("Square order identity or location does not match");
    if (order.tenders !== undefined && (!Array.isArray(order.tenders) || order.tenders.length > 100)) throw new BadRequestException("Square order tenders require reconciliation");
    const paymentIds = (order.tenders as unknown[] | undefined ?? []).map(value => identifier(object(value).payment_id, "payment ID"));
    if (new Set(paymentIds).size !== paymentIds.length) throw new BadRequestException("Square order has duplicate tenders");
    return { id: expected, locationId: this.locationId!, referenceId: identifier(order.reference_id, "reference ID", 40), ...this.parseMoney(order.total_money), paymentIds };
  }

  async getPayment(id: string): Promise<SquarePayment> {
    const expected = identifier(id, "payment ID");
    const data = await this.request(`/v2/payments/${encodeURIComponent(expected)}`);
    const payment = this.parsePayment(data.payment);
    if (payment.id !== expected) throw new BadRequestException("Square payment identity does not match");
    return payment;
  }

  async getRefund(id: string): Promise<SquareRefund> {
    const expected = identifier(id, "refund ID");
    const data = await this.request(`/v2/refunds/${encodeURIComponent(expected)}`);
    const refund = this.parseRefund(data.refund);
    if (refund.id !== expected) throw new BadRequestException("Square refund identity does not match");
    return refund;
  }

  async createCheckout(input: SquareCheckoutInput): Promise<SquareCheckout> {
    this.requireEnabled();
    const money = this.money(input.amountCents, input.currency);
    const referenceId = identifier(input.referenceId, "reference ID", 40);
    const data = await this.request("/v2/online-checkout/payment-links", {
      idempotency_key: this.key("checkout", input.idempotencyKey),
      order: {
        location_id: this.locationId,
        reference_id: referenceId,
        line_items: [
          {
            name: "Massajoy appointment",
            quantity: "1",
            base_price_money: money,
          },
        ],
        pricing_options: {
          auto_apply_discounts: false,
          auto_apply_taxes: false,
        },
      },
      checkout_options: {
        allow_tipping: false,
        ask_for_shipping_address: false,
        enable_coupon: false,
        enable_loyalty: false,
        redirect_url: this.redirectUrl,
      },
    });
    try {
      const link = object(data.payment_link);
      const checkoutId = identifier(link.id, "checkout ID");
      const orderId = identifier(link.order_id, "order ID");
      const checkoutUrl = identifier(link.url, "checkout URL", 2048);
      const url = new URL(checkoutUrl);
      const allowedHost =
        url.hostname === "square.link" ||
        url.hostname === "sandbox.square.link" ||
        url.hostname === "checkout.square.site" ||
        url.hostname.endsWith(".square.site") ||
        (this.environment === "sandbox" &&
          url.hostname.endsWith(".squareupsandbox.com"));
      if (
        url.protocol !== "https:" ||
        !allowedHost ||
        url.username ||
        url.password ||
        url.hash ||
        (this.environment === "production" &&
          url.hostname === "sandbox.square.link")
      )
        throw new Error("Invalid checkout URL");
      const orders =
        data.related_resources && object(data.related_resources).orders;
      if (orders !== undefined) {
        if (!Array.isArray(orders)) throw new Error("Invalid related orders");
        const order = orders.map(object).find((value) => value.id === orderId);
        if (!order || order.location_id !== this.locationId)
          throw new Error("Order location mismatch");
        const total = object(order.total_money);
        if (total.amount !== money.amount || total.currency !== money.currency)
          throw new Error("Order amount mismatch");
      }
      return {
        checkoutId,
        checkoutUrl,
        orderId,
        amountCents: money.amount,
        currency: money.currency.toLowerCase(),
      };
    } catch {
      throw new ServiceUnavailableException(
        "Square returned incomplete or inconsistent checkout details",
      );
    }
  }

  async refund(input: SquareRefundInput): Promise<SquareRefund> {
    this.requireEnabled();
    const amount = this.money(input.amountCents, input.currency);
    const paymentId = identifier(input.paymentId, "payment ID");
    if (
      input.referenceId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.referenceId,
      )
    ) {
      throw new BadRequestException("Square refund reference must be a UUID");
    }
    const data = await this.request("/v2/refunds", {
      idempotency_key: this.key("refund", input.idempotencyKey),
      payment_id: paymentId,
      amount_money: amount,
      ...(input.referenceId
        ? { reason: `Massajoy refund ${input.referenceId}` }
        : {}),
    });
    try {
      const refund = this.parseRefund(data.refund);
      if (
        refund.paymentId !== paymentId ||
        refund.amountCents !== amount.amount ||
        refund.currency !== amount.currency.toLowerCase()
      ) {
        throw new Error("Refund differs from request");
      }
      if (
        refund.referenceId &&
        input.referenceId &&
        refund.referenceId !== input.referenceId
      ) {
        throw new Error("Refund reference differs from request");
      }
      return refund;
    } catch {
      throw new ServiceUnavailableException(
        "Square returned incomplete or inconsistent refund details",
      );
    }
  }

  /** Sign the exact configured notification URL followed by the unchanged raw bytes. Never use a forwarded URL. */
  verifyWebhookSignature(
    rawBody: Buffer,
    signature: string | undefined,
  ): boolean {
    this.requireEnabled();
    if (
      !Buffer.isBuffer(rawBody) ||
      !rawBody.length ||
      rawBody.length > 1048576 ||
      !signature ||
      !/^[A-Za-z0-9+/]{43}=$/.test(signature)
    )
      return false;
    const expected = createHmac("sha256", this.signatureKey!)
      .update(this.notificationUrl!, "utf8")
      .update(rawBody)
      .digest();
    const received = Buffer.from(signature, "base64");
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  }

  parseWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): SquareWebhookEvent {
    if (!this.verifyWebhookSignature(rawBody, signature))
      throw new BadRequestException("Invalid Square webhook signature");
    let event: JsonObject;
    try {
      event = object(JSON.parse(rawBody.toString("utf8")));
    } catch {
      throw new BadRequestException("Invalid Square webhook payload");
    }
    const id = identifier(event.event_id, "event ID");
    const type = identifier(event.type, "event type");
    const merchantId = identifier(event.merchant_id, "merchant ID");
    if (merchantId !== this.merchantId)
      throw new BadRequestException("Square webhook merchant does not match");
    if (
      [
        "payment.created",
        "payment.updated",
        "refund.created",
        "refund.updated",
      ].includes(type)
    ) {
      const data = object(event.data);
      const value = object(data.object);
      if (type.startsWith("payment.")) {
        const payment = this.parsePayment(value.payment);
        if (data.id !== undefined && data.id !== payment.id)
          throw new BadRequestException("Square payment ID mismatch");
        return { id, type, merchantId, kind: "payment", payment };
      }
      const refund = this.parseRefund(value.refund);
      if (data.id !== undefined && data.id !== refund.id)
        throw new BadRequestException("Square refund ID mismatch");
      return { id, type, merchantId, kind: "refund", refund };
    }
    return { id, type, merchantId, kind: "ignored" };
  }

  verifyWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): SquareWebhookEvent {
    return this.parseWebhook(rawBody, signature);
  }

  private parseMoney(value: unknown): {
    amountCents: number;
    currency: string;
  } {
    const money = object(value);
    if (money.currency !== this.currency)
      throw new BadRequestException("Square event currency does not match");
    return {
      amountCents: positiveCents(money.amount),
      currency: this.currency!.toLowerCase(),
    };
  }

  private parsePayment(value: unknown): SquarePayment {
    const payment = object(value);
    const status = payment.status as SquarePayment["status"];
    if (
      !["APPROVED", "PENDING", "COMPLETED", "CANCELED", "FAILED"].includes(
        status,
      )
    )
      throw new BadRequestException("Invalid Square payment status");
    if (payment.location_id !== this.locationId)
      throw new BadRequestException("Square event location does not match");
    const money = this.parseMoney(payment.amount_money);
    const total =
      payment.total_money === undefined && status !== "COMPLETED"
        ? money
        : this.parseMoney(payment.total_money);
    return {
      id: identifier(payment.id, "payment ID"),
      orderId: identifier(payment.order_id, "order ID"),
      locationId: this.locationId!,
      status,
      ...money,
      totalCents: total.amountCents,
      ...(payment.reference_id === undefined
        ? {}
        : {
            referenceId: identifier(payment.reference_id, "reference ID", 40),
          }),
    };
  }

  private parseRefund(value: unknown): SquareRefund {
    const refund = object(value);
    const status = refund.status as SquareRefund["status"];
    if (!["PENDING", "COMPLETED", "REJECTED", "FAILED"].includes(status))
      throw new BadRequestException("Invalid Square refund status");
    if (refund.location_id !== this.locationId)
      throw new BadRequestException("Square event location does not match");
    // Optional standard PaymentRefund.reason. Missing/foreign reasons must not be guessed from an amount.
    const reference =
      typeof refund.reason === "string"
        ? /^Massajoy refund ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.exec(
            refund.reason,
          )?.[1]
        : undefined;
    return {
      id: identifier(refund.id, "refund ID"),
      paymentId: identifier(refund.payment_id, "payment ID"),
      ...(refund.order_id === undefined
        ? {}
        : { orderId: identifier(refund.order_id, "order ID") }),
      locationId: this.locationId!,
      status,
      ...this.parseMoney(refund.amount_money),
      ...(reference ? { referenceId: reference } : {}),
    };
  }
}
