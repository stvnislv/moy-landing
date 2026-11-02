import { getStore } from "@netlify/blobs";
import {
  ConfigurationError,
  getCheckoutConfig,
  isOrderId,
  jsonResponse,
  readJsonBody,
  RequestValidationError,
  validateCheckoutData,
  formatKopeks,
} from "./_shared/payment.mjs";
import { createYooKassaPayment } from "./_shared/yookassa.mjs";
import { randomUUID } from "node:crypto";

export default async function createPayment(request) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Метод не поддерживается." }, 405);
  }

  let config;
  try {
    config = getCheckoutConfig();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    console.error("Настройте переменные окружения ЮKassa:", error.message);
    return jsonResponse({ error: "Тестовая оплата пока не настроена." }, 503);
  }

  if (request.headers.get("origin") !== config.siteUrl) {
    return jsonResponse({ error: "Запрос отклонён." }, 403);
  }

  let customer;
  try {
    customer = validateCheckoutData(await readJsonBody(request));
  } catch (error) {
    if (!(error instanceof RequestValidationError)) throw error;
    return jsonResponse({ error: error.message }, 400);
  }

  const orderId = randomUUID();
  if (!isOrderId(orderId)) throw new Error("Не удалось создать идентификатор заказа.");

  const store = getStore("yookassa-orders");
  const createdAt = new Date().toISOString();
  const order = {
    amountKopeks: config.amountKopeks,
    createdAt,
    paymentId: null,
    status: "creating",
  };
  const stored = await store.setJSON(orderId, order, { onlyIfNew: true });
  if (!stored.modified) throw new Error("Не удалось зарезервировать идентификатор заказа.");

  let payment;
  try {
    payment = await createYooKassaPayment({
      amount: {
        value: formatKopeks(config.amountKopeks),
        currency: "RUB",
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: `${config.siteUrl}/?payment=${encodeURIComponent(orderId)}`,
      },
      description: config.itemName,
      metadata: {
        order_id: orderId,
        customer_name: customer.name,
        customer_email: customer.email,
      },
    }, config.credentials, orderId);
  } catch (error) {
    await store.setJSON(orderId, { ...order, status: "failed" });
    console.error("Не удалось создать платёж ЮKassa:", {
      status: Number.isInteger(error?.status) ? error.status : "network_error",
    });
    return jsonResponse({ error: "Не удалось создать платёж. Попробуйте позже." }, 502);
  }

  let confirmationUrl;
  try {
    confirmationUrl = new URL(payment.confirmation?.confirmation_url);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    await store.setJSON(orderId, { ...order, paymentId: payment.id ?? null, status: "failed" });
    console.error("ЮKassa вернула некорректную ссылку для оплаты.");
    return jsonResponse({ error: "Не удалось создать ссылку для оплаты." }, 502);
  }
  if (!payment.id || payment.test !== true || confirmationUrl.protocol !== "https:") {
    await store.setJSON(orderId, { ...order, paymentId: payment.id ?? null, status: "failed" });
    console.error("ЮKassa не подтвердила тестовый режим или вернула некорректные данные платежа.");
    return jsonResponse({ error: "Не удалось создать ссылку для оплаты." }, 502);
  }

  await store.setJSON(orderId, {
    ...order,
    paymentId: payment.id,
    status: "pending",
  });

  return jsonResponse({
    orderId,
    confirmationUrl: confirmationUrl.href,
  });
}
