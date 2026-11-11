import { jsonResponse, readJsonBody as readJson, RequestValidationError } from "../../../server/lib/http.mjs";

export { jsonResponse, RequestValidationError };
export class ConfigurationError extends Error {}

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getCredentials(env = process.env) {
  if (env.YOOKASSA_MODE !== "test") {
    throw new ConfigurationError("YOOKASSA_MODE должен быть равен test.");
  }

  const shopId = env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = env.YOOKASSA_SECRET_KEY?.trim();
  if (!shopId || !/^\d+$/.test(shopId)) {
    throw new ConfigurationError("Не задан корректный YOOKASSA_SHOP_ID.");
  }
  if (!secretKey) {
    throw new ConfigurationError("Не задан YOOKASSA_SECRET_KEY.");
  }

  return { shopId, secretKey };
}

export function getCheckoutConfig(env = process.env) {
  const { shopId, secretKey } = getCredentials(env);
  const amountKopeks = env.YOOKASSA_AMOUNT_KOPEKS?.trim();
  if (!amountKopeks || !/^[1-9]\d{0,11}$/.test(amountKopeks)) {
    throw new ConfigurationError("Не задана корректная YOOKASSA_AMOUNT_KOPEKS.");
  }

  const itemName = env.YOOKASSA_ITEM_NAME?.trim();
  if (!itemName || itemName.length > 128 || /[\u0000-\u001f\u007f]/.test(itemName)) {
    throw new ConfigurationError("Не задано корректное YOOKASSA_ITEM_NAME.");
  }

  const configuredSiteUrl = env.SITE_URL?.trim();
  if (!configuredSiteUrl) throw new ConfigurationError("Не задан SITE_URL.");

  let siteUrl;
  try {
    siteUrl = new URL(configuredSiteUrl);
  } catch (error) {
    if (error instanceof TypeError) throw new ConfigurationError("Некорректный SITE_URL.");
    throw error;
  }
  const isLocalHttp = siteUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(siteUrl.hostname);
  if (siteUrl.protocol !== "https:" && !isLocalHttp) {
    throw new ConfigurationError("SITE_URL должен использовать HTTPS.");
  }
  if (siteUrl.pathname !== "/" || siteUrl.search || siteUrl.hash || siteUrl.username || siteUrl.password) {
    throw new ConfigurationError("SITE_URL должен содержать только адрес сайта без пути и параметров.");
  }

  return {
    credentials: { shopId, secretKey },
    amountKopeks,
    itemName,
    siteUrl: siteUrl.origin,
  };
}

export function validateCheckoutData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError("Проверьте имя и электронную почту.");
  }
  if (Object.keys(value).some((key) => !["name", "email"].includes(key))) {
    throw new RequestValidationError("Форма содержит неизвестные поля.");
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  const email = typeof value.email === "string" ? value.email.trim() : "";
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new RequestValidationError("Укажите имя длиной до 100 символов.");
  }
  if (
    email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || /[\u0000-\u001f\u007f]/.test(email)
  ) {
    throw new RequestValidationError("Укажите корректную электронную почту.");
  }

  return { name, email };
}

// Форма оплаты маленькая: тело не больше 4 КБ.
export function readJsonBody(request) {
  return readJson(request, { maxBytes: 4096 });
}

export function isOrderId(value) {
  return typeof value === "string" && ORDER_ID_PATTERN.test(value);
}

export function formatKopeks(amountKopeks) {
  const amount = BigInt(amountKopeks);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}

export function toKopeks(amount) {
  if (typeof amount !== "string") return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) return null;
  return (BigInt(match[1]) * 100n) + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}
