import { getStore } from "@netlify/blobs";
import {
  ConfigurationError,
  getCredentials,
  jsonResponse,
  readJsonBody,
  RequestValidationError,
  toKopeks,
} from "./_shared/payment.mjs";
import { getYooKassaPayment } from "./_shared/yookassa.mjs";

const HANDLED_EVENTS = new Set([
  "payment.succeeded",
  "payment.canceled",
  "payment.waiting_for_capture",
]);

export default async function yooKassaWebhook(request) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Метод не поддерживается." }, 405);
  }

  let notification;
  try {
    notification = await readJsonBody(request);
  } catch (error) {
    if (!(error instanceof RequestValidationError)) throw error;
    return jsonResponse({ error: error.message }, 400);
  }

  if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
    return jsonResponse({ error: "Некорректное уведомление." }, 400);
  }
  if (!HANDLED_EVENTS.has(notification.event)) return jsonResponse({ received: true });

  const paymentId = notification.object?.id;
  if (typeof paymentId !== "string" || paymentId.length > 128) {
    return jsonResponse({ error: "Некорректное уведомление." }, 400);
  }

  let credentials;
  try {
    credentials = getCredentials();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    console.error("Настройте переменные окружения ЮKassa:", error.message);
    return jsonResponse({ error: "Webhook временно недоступен." }, 503);
  }

  let payment;
  try {
    payment = await getYooKassaPayment(paymentId, credentials);
  } catch (error) {
    console.error("Не удалось проверить уведомление через API ЮKassa:", {
      status: Number.isInteger(error?.status) ? error.status : "network_error",
    });
    return jsonResponse({ error: "Не удалось проверить платёж." }, 503);
  }

  const orderId = payment.metadata?.order_id;
  if (typeof orderId !== "string") return jsonResponse({ received: true });

  const store = getStore("yookassa-orders");
  const order = await store.get(orderId, { type: "json" });
  const paymentAmount = toKopeks(payment.amount?.value);
  if (
    !order
    || order.paymentId !== payment.id
    || order.amountKopeks !== String(paymentAmount)
    || payment.amount?.currency !== "RUB"
    || payment.test !== true
  ) {
    console.error("Уведомление ЮKassa не совпало с ожидаемыми данными заказа.");
    return jsonResponse({ received: true });
  }

  let status = "pending";
  if (payment.status === "succeeded" && payment.paid === true) status = "succeeded";
  if (payment.status === "canceled") status = "canceled";
  if (status !== "pending" && order.status !== "succeeded") {
    await store.setJSON(orderId, { ...order, status });
  }

  return jsonResponse({ received: true });
}
