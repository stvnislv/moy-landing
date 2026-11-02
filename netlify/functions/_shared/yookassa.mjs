import { Buffer } from "node:buffer";

export class YooKassaError extends Error {
  constructor(status) {
    super("Запрос к API ЮKassa завершился ошибкой.");
    this.status = status;
  }
}

async function requestYooKassa(path, { method, credentials, body, idempotenceKey }) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${credentials.shopId}:${credentials.secretKey}`).toString("base64")}`,
  };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotenceKey) headers["Idempotence-Key"] = idempotenceKey;

  const response = await fetch(`https://api.yookassa.ru/v3/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });

  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new YooKassaError(response.status);
    throw error;
  }
  if (!response.ok) throw new YooKassaError(response.status);
  return result;
}

export function createYooKassaPayment(payment, credentials, idempotenceKey) {
  return requestYooKassa("payments", {
    method: "POST",
    credentials,
    body: payment,
    idempotenceKey,
  });
}

export function getYooKassaPayment(paymentId, credentials) {
  return requestYooKassa(`payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    credentials,
  });
}
