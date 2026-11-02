import { getStore } from "@netlify/blobs";
import { isOrderId, jsonResponse } from "./_shared/payment.mjs";

export default async function paymentStatus(request) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Метод не поддерживается." }, 405);
  }

  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!isOrderId(orderId)) return jsonResponse({ error: "Некорректный идентификатор заказа." }, 400);

  const order = await getStore("yookassa-orders").get(orderId, { type: "json" });
  if (!order) return jsonResponse({ error: "Заказ не найден." }, 404);

  const status = order.status === "creating" ? "pending" : order.status;
  if (!["pending", "succeeded", "canceled", "failed"].includes(status)) {
    throw new Error("В хранилище найден неизвестный статус заказа.");
  }
  return jsonResponse({ status });
}
