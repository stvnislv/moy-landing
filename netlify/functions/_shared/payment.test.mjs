import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfigurationError,
  formatKopeks,
  getCheckoutConfig,
  isOrderId,
  readJsonBody,
  RequestValidationError,
  toKopeks,
  validateCheckoutData,
} from "./payment.mjs";

const validEnv = {
  YOOKASSA_MODE: "test",
  YOOKASSA_SHOP_ID: "123456",
  YOOKASSA_SECRET_KEY: "test-secret",
  YOOKASSA_AMOUNT_KOPEKS: "2500000",
  YOOKASSA_ITEM_NAME: "Согласованная услуга",
  SITE_URL: "https://example.com",
};

test("checkout configuration accepts only an explicit test setup", () => {
  assert.deepEqual(getCheckoutConfig(validEnv), {
    credentials: { shopId: "123456", secretKey: "test-secret" },
    amountKopeks: "2500000",
    itemName: "Согласованная услуга",
    siteUrl: "https://example.com",
  });
  assert.throws(() => getCheckoutConfig({ ...validEnv, YOOKASSA_MODE: "live" }), ConfigurationError);
  assert.throws(() => getCheckoutConfig({ ...validEnv, YOOKASSA_AMOUNT_KOPEKS: "250.00" }), ConfigurationError);
  assert.throws(() => getCheckoutConfig({ ...validEnv, SITE_URL: "http://example.com" }), ConfigurationError);
});

test("checkout form accepts trimmed name and valid email only", () => {
  assert.deepEqual(validateCheckoutData({ name: " Анна ", email: " anna@example.com " }), {
    name: "Анна",
    email: "anna@example.com",
  });
  assert.throws(() => validateCheckoutData({ name: "", email: "anna@example.com" }), RequestValidationError);
  assert.throws(() => validateCheckoutData({ name: "Анна", email: "not-an-email" }), RequestValidationError);
  assert.throws(() => validateCheckoutData({ name: "Анна", email: "anna@example.com", amount: 1 }), RequestValidationError);
});

test("JSON body parsing rejects wrong content types, malformed, and oversized input", async () => {
  await assert.rejects(
    readJsonBody(new Request("https://example.com", { method: "POST", body: "{}", headers: { "Content-Type": "text/plain" } })),
    RequestValidationError,
  );
  await assert.rejects(
    readJsonBody(new Request("https://example.com", { method: "POST", body: "{", headers: { "Content-Type": "application/json" } })),
    RequestValidationError,
  );
  await assert.rejects(
    readJsonBody(new Request("https://example.com", {
      method: "POST",
      body: JSON.stringify({ data: "x".repeat(4096) }),
      headers: { "Content-Type": "application/json" },
    })),
    RequestValidationError,
  );
});

test("amount conversion uses integer kopeks without floating point", () => {
  assert.equal(formatKopeks("100"), "1.00");
  assert.equal(formatKopeks("2500000"), "25000.00");
  assert.equal(toKopeks("25.40"), 2540n);
  assert.equal(toKopeks("25.4"), 2540n);
  assert.equal(toKopeks("25.400"), null);
});

test("order identifiers must be UUIDs", () => {
  assert.equal(isOrderId("a7a5e17c-83f1-4fa8-986b-3bf3305a190f"), true);
  assert.equal(isOrderId("../payment"), false);
  assert.equal(isOrderId(null), false);
});
