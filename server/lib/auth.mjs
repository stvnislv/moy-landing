// Проверка Telegram Mini App initData и владельца.
// Алгоритм — из документации Telegram (core.telegram.org/bots/webapps, «Validating data received via the Mini App»):
//   data-check-string = все поля, кроме hash, отсортированные по имени, «ключ=значение» через \n;
//   secret = HMAC-SHA256(key="WebAppData", message=токен бота);
//   hash   = hex(HMAC-SHA256(key=secret, message=data-check-string)).
// initDataUnsafe на сервере не используется никогда: только строка initData, проверенная здесь.

import { createHmac, timingSafeEqual } from "node:crypto";

export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;
const MAX_INIT_DATA_LENGTH = 4096;

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

export function getBotToken(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !/^\d+:[\w-]{30,}$/.test(token)) throw new Error("Не задан корректный TELEGRAM_BOT_TOKEN.");
  return token;
}

export function getOwnerId(env = process.env) {
  const id = env.OWNER_TELEGRAM_ID?.trim();
  if (!id || !/^[1-9]\d{0,15}$/.test(id)) throw new Error("Не задан корректный OWNER_TELEGRAM_ID.");
  return Number(id);
}

function dataCheckString(params) {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function signature(params, botToken) {
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(dataCheckString(params)).digest("hex");
}

/** Подписать initData — для тестов (так же подписывает Telegram). */
export function signInitData(fields, botToken) {
  const params = new URLSearchParams(fields);
  params.set("hash", signature(params, botToken));
  return params.toString();
}

/**
 * Проверить initData. Возвращает { user, authDate, startParam, chatType, queryId }.
 * Бросает AuthError(401), если подпись неверна, данные просрочены или в них нет пользователя.
 */
export function verifyInitData(initData, botToken, { now = Date.now(), maxAgeSeconds = INIT_DATA_MAX_AGE_SECONDS } = {}) {
  if (typeof initData !== "string" || !initData || initData.length > MAX_INIT_DATA_LENGTH) {
    throw new AuthError("Нет данных авторизации Telegram.");
  }
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash) || params.getAll("hash").length !== 1) {
    throw new AuthError("Неверная подпись Telegram.");
  }
  const expected = Buffer.from(signature(params, botToken), "hex");
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) {
    throw new AuthError("Неверная подпись Telegram.");
  }

  const authDate = Number(params.get("auth_date"));
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isInteger(authDate) || authDate <= 0) throw new AuthError("Неверная подпись Telegram.");
  if (nowSeconds - authDate > maxAgeSeconds) throw new AuthError("Сессия Telegram устарела. Откройте приложение заново.");
  if (authDate - nowSeconds > CLOCK_SKEW_SECONDS) throw new AuthError("Неверная подпись Telegram.");

  let user;
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    user = null;
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new AuthError("В данных Telegram нет пользователя.");
  }

  return {
    user: {
      id: user.id,
      firstName: typeof user.first_name === "string" ? user.first_name : "",
      lastName: typeof user.last_name === "string" ? user.last_name : "",
      username: typeof user.username === "string" ? user.username : "",
      allowsWriteToPm: user.allows_write_to_pm === true,
    },
    authDate,
    startParam: params.get("start_param") ?? "",
    chatType: params.get("chat_type") ?? "",
    queryId: params.get("query_id") ?? "",
  };
}

/** initData из заголовка «Authorization: tma <initData>» или null, если заголовка нет. */
export function initDataFromRequest(request) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^tma (.+)$/s.exec(header);
  if (!match) throw new AuthError("Неверный формат авторизации.");
  return match[1];
}

/** Проверенный пользователь Mini App из запроса или null, если запрос без авторизации. */
export function telegramUserFromRequest(request, env = process.env, options) {
  const initData = initDataFromRequest(request);
  if (initData === null) return null;
  return verifyInitData(initData, getBotToken(env), options);
}

/** Пропускает только владельца: 401 — нет или неверная подпись, 403 — подпись верна, но это не владелец. */
export function requireOwner(request, env = process.env, options) {
  const session = telegramUserFromRequest(request, env, options);
  if (!session) throw new AuthError("Нужна авторизация Telegram.");
  if (session.user.id !== getOwnerId(env)) throw new AuthError("Доступ только для владельца.", 403);
  return session;
}

/** Обновление от Telegram (webhook) — только с секретом, заданным в setWebhook. */
export function isTelegramWebhook(request, env = process.env) {
  const expected = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const received = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || !/^[A-Za-z0-9_-]{32,256}$/.test(expected)) throw new Error("Не задан корректный TELEGRAM_WEBHOOK_SECRET.");
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
