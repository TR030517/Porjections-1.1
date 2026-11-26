import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import {
  SQUARE_API_VERSION,
  SquareProvider,
  SquareTransport,
} from "./square.provider";

const environment: NodeJS.ProcessEnv = {
  PAYMENT_PROVIDER: "square",
  PAYMENT_EXTERNAL_ENABLED: "true",
  SQUARE_ENVIRONMENT: "sandbox",
  SQUARE_ACCESS_TOKEN: "local-unit-test-token",
  SQUARE_LOCATION_ID: "LOCATION_TEST",
  SQUARE_MERCHANT_ID: "MERCHANT_TEST",
  SQUARE_CURRENCY: "USD",
  SQUARE_SHOP_ID: "42",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "local-unit-test-signature-key",
  SQUARE_WEBHOOK_NOTIFICATION_URL:
    "https://api.example.test/api/v1/payments/webhook/square",
  SQUARE_CHECKOUT_REDIRECT_URL: "https://app.example.test/",
};
const checkout = {
  idempotencyKey: "booking:42:payment:v1",
  amountCents: 12345,
  currency: "usd",
  referenceId: "record_42",
};
const link = {
  id: "LINK_TEST",
  order_id: "ORDER_TEST",
  url: "https://sandbox.square.link/u/unit-test",
};
const payment = {
  id: "PAYMENT_TEST",
  order_id: "ORDER_TEST",
  location_id: "LOCATION_TEST",
  status: "COMPLETED",
  amount_money: { amount: 12345, currency: "USD" },
  total_money: { amount: 12345, currency: "USD" },
  card_details: { card: { last_4: "0000" } },
};
const refund = {
  id: "REFUND_TEST",
  payment_id: "PAYMENT_TEST",
  order_id: "ORDER_TEST",
  location_id: "LOCATION_TEST",
  status: "PENDING",
  amount_money: { amount: 1000, currency: "USD" },
};

function mockTransport(payload: unknown, status = 200) {
  return jest.fn(
    async (..._args: Parameters<SquareTransport>) =>
      new Response(JSON.stringify(payload), { status }),
  ) as jest.MockedFunction<SquareTransport>;
}

function envelope(type: string, value: unknown, id = "EVENT_TEST") {
  const kind = type.startsWith("payment.") ? "payment" : "refund";
  return {
    event_id: id,
    type,
    merchant_id: "MERCHANT_TEST",
    data: { type: kind, object: { [kind]: value } },
  };
}

function signed(value: unknown, env = environment) {
  const raw = Buffer.from(JSON.stringify(value));
  const signature = createHmac("sha256", env.SQUARE_WEBHOOK_SIGNATURE_KEY!)
    .update(env.SQUARE_WEBHOOK_NOTIFICATION_URL!)
    .update(raw)
    .digest("base64");
  return { raw, signature };
}

describe("SquareProvider (mocked transport; no external payment requests)", () => {
  test('shop binding is required and the private configuration snapshot detects account and key changes', () => {
    for (const shopId of ['', '0', '-1', '01', '1.0', '9223372036854775808', ' 42']) expect(new SquareProvider({ ...environment, SQUARE_SHOP_ID:shopId }).config().enabled).toBe(false);
    const original = new SquareProvider(environment).binding();
    expect(original.shopId).toBe('42'); expect(original.configurationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(new SquareProvider({ ...environment }).binding()).toEqual(original);
    for (const key of ['SQUARE_ACCESS_TOKEN','SQUARE_LOCATION_ID','SQUARE_MERCHANT_ID','SQUARE_WEBHOOK_SIGNATURE_KEY']) expect(new SquareProvider({...environment,[key]:`${environment[key]}_changed`}).binding().configurationHash).not.toBe(original.configurationHash);
    expect(JSON.stringify(original)).not.toContain(environment.SQUARE_ACCESS_TOKEN!);expect(JSON.stringify(original)).not.toContain(environment.SQUARE_WEBHOOK_SIGNATURE_KEY!);
    expect(new SquareProvider(environment).config()).not.toHaveProperty('configurationHash');
  });
  test("fails closed without explicit enablement and every server setting", async () => {
    const transport = mockTransport({ payment_link: link });
    for (const key of Object.keys(environment)) {
      const env = { ...environment };
      delete env[key];
      const provider = new SquareProvider(env, transport);
      expect(provider.config().enabled).toBe(false);
      await expect(provider.createCheckout(checkout)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
    expect(
      new SquareProvider(
        { ...environment, PAYMENT_PROVIDER: "stripe" },
        transport,
      ).config().enabled,
    ).toBe(false);
    expect(
      new SquareProvider(
        { ...environment, PAYMENT_EXTERNAL_ENABLED: "TRUE" },
        transport,
      ).config().enabled,
    ).toBe(false);
    expect(
      new SquareProvider(
        { ...environment, SQUARE_ENVIRONMENT: "staging" },
        transport,
      ).config().enabled,
    ).toBe(false);
    expect(
      new SquareProvider(
        { ...environment, SQUARE_TIMEOUT_MS: "NaN" },
        transport,
      ).config().enabled,
    ).toBe(false);
    expect(
      new SquareProvider(
        {
          ...environment,
          SQUARE_ENVIRONMENT: "production",
          SQUARE_CHECKOUT_REDIRECT_URL: "http://localhost/",
        },
        transport,
      ).config().enabled,
    ).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  test("creates a server-fixed hosted checkout, with stable bounded idempotency and no card data", async () => {
    const transport = mockTransport({
      payment_link: link,
      related_resources: {
        orders: [
          {
            id: "ORDER_TEST",
            location_id: "LOCATION_TEST",
            total_money: payment.total_money,
          },
        ],
      },
    });
    const provider = new SquareProvider(environment, transport);
    await expect(provider.createCheckout(checkout)).resolves.toEqual({
      checkoutId: "LINK_TEST",
      checkoutUrl: link.url,
      orderId: "ORDER_TEST",
      amountCents: 12345,
      currency: "usd",
    });
    await provider.createCheckout(checkout);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe(
      "https://connect.squareupsandbox.com/v2/online-checkout/payment-links",
    );
    expect(options?.redirect).toBe("error");
    expect(options?.headers).toEqual(
      expect.objectContaining({ "Square-Version": SQUARE_API_VERSION }),
    );
    const body = JSON.parse(options!.body as string);
    expect(body.order).toEqual({
      location_id: "LOCATION_TEST",
      reference_id: "record_42",
      line_items: [
        {
          name: "Massajoy appointment",
          quantity: "1",
          base_price_money: { amount: 12345, currency: "USD" },
        },
      ],
      pricing_options: { auto_apply_discounts: false, auto_apply_taxes: false },
    });
    expect(body.checkout_options).toEqual({
      allow_tipping: false,
      ask_for_shipping_address: false,
      enable_coupon: false,
      enable_loyalty: false,
      redirect_url: environment.SQUARE_CHECKOUT_REDIRECT_URL,
    });
    expect(body.idempotency_key).toHaveLength(40);
    expect(
      JSON.parse(transport.mock.calls[1][1]!.body as string).idempotency_key,
    ).toBe(body.idempotency_key);
    expect(JSON.stringify(body)).not.toMatch(
      /card_number|cvv|local-unit-test-token/,
    );
  });

  test("uses the production origin only when explicitly configured and never redirects to another provider", async () => {
    const transport = mockTransport({
      payment_link: { ...link, url: "https://square.link/u/unit-test" },
    });
    await new SquareProvider(
      { ...environment, SQUARE_ENVIRONMENT: "production" },
      transport,
    ).createCheckout(checkout);
    expect(transport.mock.calls[0][0]).toBe(
      "https://connect.squareup.com/v2/online-checkout/payment-links",
    );
    const malicious = mockTransport({
      payment_link: { ...link, url: "https://square.link.attacker.test/pay" },
    });
    await expect(
      new SquareProvider(environment, malicious).createCheckout(checkout),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    const wrongEnvironment = mockTransport({ payment_link: link });
    await expect(
      new SquareProvider(
        { ...environment, SQUARE_ENVIRONMENT: "production" },
        wrongEnvironment,
      ).createCheckout(checkout),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  test("rejects client-like mismatches, invalid amounts, and invalid reference IDs before transport", async () => {
    const transport = mockTransport({ payment_link: link });
    const provider = new SquareProvider(environment, transport);
    for (const amountCents of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, NaN]) {
      await expect(
        provider.createCheckout({ ...checkout, amountCents }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      provider.createCheckout({ ...checkout, currency: "eur" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      provider.createCheckout({ ...checkout, referenceId: "a".repeat(41) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transport).not.toHaveBeenCalled();
  });

  test("rejects missing checkout fields and mismatched returned order totals", async () => {
    for (const response of [
      {},
      { payment_link: { id: "LINK_TEST", url: link.url } },
      {
        payment_link: link,
        related_resources: {
          orders: [
            {
              id: "ORDER_TEST",
              location_id: "WRONG",
              total_money: payment.total_money,
            },
          ],
        },
      },
      {
        payment_link: link,
        related_resources: {
          orders: [
            {
              id: "ORDER_TEST",
              location_id: "LOCATION_TEST",
              total_money: { amount: 1, currency: "USD" },
            },
          ],
        },
      },
    ]) {
      await expect(
        new SquareProvider(environment, mockTransport(response)).createCheckout(
          checkout,
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
  });

  test("requests idempotent linked refunds and returns pending without claiming settlement", async () => {
    const transport = mockTransport({ refund });
    const provider = new SquareProvider(environment, transport);
    const input = {
      idempotencyKey: "booking:42:refund:partial:one",
      paymentId: "PAYMENT_TEST",
      amountCents: 1000,
      currency: "USD",
    };
    await expect(provider.refund(input)).resolves.toEqual({
      id: "REFUND_TEST",
      paymentId: "PAYMENT_TEST",
      orderId: "ORDER_TEST",
      locationId: "LOCATION_TEST",
      status: "PENDING",
      amountCents: 1000,
      currency: "usd",
    });
    await provider.refund(input);
    const body = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(transport.mock.calls[0][0]).toBe(
      "https://connect.squareupsandbox.com/v2/refunds",
    );
    expect(body).toEqual({
      payment_id: "PAYMENT_TEST",
      amount_money: { amount: 1000, currency: "USD" },
      idempotency_key: expect.any(String),
    });
    expect(body.idempotency_key).toHaveLength(40);
    expect(
      JSON.parse(transport.mock.calls[1][1]!.body as string).idempotency_key,
    ).toBe(body.idempotency_key);
    await provider.createCheckout(checkout).catch(() => undefined);
    expect(body.idempotency_key).not.toBe(
      JSON.parse(transport.mock.calls[2][1]!.body as string).idempotency_key,
    );
  });

  test("rejects missing or mismatched provider refund details", async () => {
    for (const value of [
      {},
      { ...refund, payment_id: "ANOTHER" },
      { ...refund, amount_money: { amount: 999, currency: "USD" } },
      { ...refund, status: "UNKNOWN" },
      { ...refund, location_id: "ANOTHER" },
    ]) {
      const provider = new SquareProvider(
        environment,
        mockTransport({ refund: value }),
      );
      await expect(
        provider.refund({
          idempotencyKey: "refund:42",
          paymentId: "PAYMENT_TEST",
          amountCents: 1000,
          currency: "usd",
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
  });

  test("carries the exact refund UUID in the standard reason for response-loss reconciliation", async () => {
    const referenceId = "2f56933e-bc42-457c-a7c9-682432648f8b";
    const transport = mockTransport({
      refund: { ...refund, reason: `Massajoy refund ${referenceId}` },
    });
    const provider = new SquareProvider(environment, transport);
    await expect(
      provider.refund({
        idempotencyKey: "refund:42",
        paymentId: "PAYMENT_TEST",
        amountCents: 1000,
        currency: "usd",
        referenceId,
      }),
    ).resolves.toEqual(expect.objectContaining({ referenceId }));
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string).reason).toBe(
      `Massajoy refund ${referenceId}`,
    );
    const event = signed(
      envelope("refund.updated", {
        ...refund,
        status: "COMPLETED",
        reason: `Massajoy refund ${referenceId}`,
      }),
    );
    expect(provider.verifyWebhook(event.raw, event.signature)).toEqual(
      expect.objectContaining({
        kind: "refund",
        refund: expect.objectContaining({ referenceId }),
      }),
    );
    for (const reason of [
      undefined,
      `massajoy refund ${referenceId}`,
      `Massajoy refund ${referenceId} extra`,
      "Massajoy refund arbitrary",
      referenceId,
    ]) {
      const other = signed(envelope("refund.updated", { ...refund, reason }));
      expect(provider.verifyWebhook(other.raw, other.signature)).toEqual(
        expect.objectContaining({
          refund: expect.not.objectContaining({
            referenceId: expect.anything(),
          }),
        }),
      );
    }
    await expect(
      provider.refund({
        idempotencyKey: "refund:42",
        paymentId: "PAYMENT_TEST",
        amountCents: 1000,
        currency: "usd",
        referenceId: "invalid",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test("fails on provider errors or malformed responses without exposing provider details", async () => {
    for (const transport of [
      mockTransport({ errors: [{ detail: "sensitive provider details" }] }),
      mockTransport({ secret: "sensitive provider details" }, 403),
      jest.fn(
        async (..._args: Parameters<SquareTransport>) =>
          new Response("not-json"),
      ) as jest.MockedFunction<SquareTransport>,
    ]) {
      const provider = new SquareProvider(environment, transport);
      await expect(provider.createCheckout(checkout)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await expect(provider.createCheckout(checkout)).rejects.not.toThrow(
        "sensitive provider details",
      );
      expect(
        transport.mock.calls.every((call) =>
          String(call[0]).includes("squareupsandbox.com"),
        ),
      ).toBe(true);
    }
  });

  test("aborts a timed out request rather than falling back or creating a new key", async () => {
    const transport = jest.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    ) as jest.MockedFunction<SquareTransport>;
    const provider = new SquareProvider(
      { ...environment, SQUARE_TIMEOUT_MS: "5" },
      transport,
    );
    await expect(provider.createCheckout(checkout)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  test("matches the official HMAC example and detects body or notification URL changes", () => {
    // Square's published webhook validation vector, not an application credential.
    // https://developer.squareup.com/docs/webhooks/step3validate
    const env = {
      ...environment,
      SQUARE_WEBHOOK_NOTIFICATION_URL: "https://example.com/webhook",
      SQUARE_WEBHOOK_SIGNATURE_KEY: "asdf1234",
    };
    const provider = new SquareProvider(env, mockTransport({}));
    const signature = "2kRE5qRU2tR+tBGlDwMEw2avJ7QM4ikPYD/PJ3bd9Og=";
    expect(
      provider.verifyWebhookSignature(
        Buffer.from('{"hello":"world"}'),
        signature,
      ),
    ).toBe(true);
    expect(
      provider.verifyWebhookSignature(
        Buffer.from('{ "hello":"world"}'),
        signature,
      ),
    ).toBe(false);
    expect(
      provider.verifyWebhookSignature(Buffer.from('{"hello":"world"}'), "bad"),
    ).toBe(false);
    expect(
      provider.verifyWebhookSignature(
        Buffer.from('{"hello":"world"}'),
        undefined,
      ),
    ).toBe(false);
    expect(
      new SquareProvider(
        {
          ...env,
          SQUARE_WEBHOOK_NOTIFICATION_URL: "https://example.com/webhook/",
        },
        mockTransport({}),
      ).verifyWebhookSignature(Buffer.from('{"hello":"world"}'), signature),
    ).toBe(false);
  });

  test("parses actual payment.updated envelopes without carrying card details into the ledger contract", () => {
    const provider = new SquareProvider(environment, mockTransport({}));
    const event = signed(envelope("payment.updated", payment));
    expect(provider.parseWebhook(event.raw, event.signature)).toEqual({
      id: "EVENT_TEST",
      type: "payment.updated",
      merchantId: "MERCHANT_TEST",
      kind: "payment",
      payment: {
        id: "PAYMENT_TEST",
        orderId: "ORDER_TEST",
        locationId: "LOCATION_TEST",
        status: "COMPLETED",
        amountCents: 12345,
        totalCents: 12345,
        currency: "usd",
      },
    });
    expect(
      provider.verifyWebhookSignature(
        Buffer.concat([event.raw, Buffer.from(" ")]),
        event.signature,
      ),
    ).toBe(false);
  });

  test.each(["PENDING", "COMPLETED", "REJECTED", "FAILED"])(
    "parses standard refund.updated status %s without ledger writes",
    (status) => {
      const provider = new SquareProvider(environment, mockTransport({}));
      const event = signed(envelope("refund.updated", { ...refund, status }));
      expect(provider.parseWebhook(event.raw, event.signature)).toEqual({
        id: "EVENT_TEST",
        type: "refund.updated",
        merchantId: "MERCHANT_TEST",
        kind: "refund",
        refund: {
          id: "REFUND_TEST",
          paymentId: "PAYMENT_TEST",
          orderId: "ORDER_TEST",
          locationId: "LOCATION_TEST",
          status,
          amountCents: 1000,
          currency: "usd",
        },
      });
    },
  );

  test("rejects signed malformed or cross-merchant/location/currency events", () => {
    const provider = new SquareProvider(environment, mockTransport({}));
    for (const value of [
      { ...envelope("payment.updated", payment), merchant_id: "OTHER" },
      envelope("payment.updated", { ...payment, location_id: "OTHER" }),
      envelope("payment.updated", {
        ...payment,
        amount_money: { amount: 1, currency: "EUR" },
      }),
      envelope("payment.updated", { ...payment, total_money: undefined }),
      envelope("payment.updated", {
        ...payment,
        amount_money: { amount: 1.5, currency: "USD" },
      }),
      {
        ...envelope("payment.updated", payment),
        data: { id: "OTHER", object: { payment } },
      },
      { ...envelope("payment.updated", payment), event_id: undefined },
    ]) {
      const event = signed(value);
      expect(() => provider.parseWebhook(event.raw, event.signature)).toThrow(
        BadRequestException,
      );
    }
    const valid = signed(envelope("payment.updated", payment));
    expect(() => provider.parseWebhook(valid.raw, "bad")).toThrow(
      "Invalid Square webhook signature",
    );
    const ignored = signed({
      event_id: "OTHER_EVENT",
      type: "customer.created",
      merchant_id: "MERCHANT_TEST",
    });
    expect(provider.parseWebhook(ignored.raw, ignored.signature).kind).toBe(
      "ignored",
    );
  });
});
