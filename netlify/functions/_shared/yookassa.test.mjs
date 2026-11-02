import assert from "node:assert/strict";
import test from "node:test";
import {
  createYooKassaPayment,
  getYooKassaPayment,
  YooKassaError,
} from "./yookassa.mjs";

test("YooKassa API requests use Basic auth, idempotency, and the fixed API host", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ id: "payment-id", test: true });
  };

  try {
    const credentials = { shopId: "123456", secretKey: "test-secret" };
    const payload = { amount: { value: "25.00", currency: "RUB" } };
    await createYooKassaPayment(payload, credentials, "order-id");
    await getYooKassaPayment("payment-id", credentials);

    assert.equal(requests[0].url, "https://api.yookassa.ru/v3/payments");
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[0].options.headers.Authorization, `Basic ${Buffer.from("123456:test-secret").toString("base64")}`);
    assert.equal(requests[0].options.headers["Idempotence-Key"], "order-id");
    assert.deepEqual(JSON.parse(requests[0].options.body), payload);
    assert.equal(requests[1].url, "https://api.yookassa.ru/v3/payments/payment-id");
    assert.equal(requests[1].options.method, "GET");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("YooKassa API errors preserve only the HTTP status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ description: "sensitive provider detail" }, { status: 401 });

  try {
    await assert.rejects(
      getYooKassaPayment("payment-id", { shopId: "123456", secretKey: "test-secret" }),
      (error) => error instanceof YooKassaError && error.status === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
