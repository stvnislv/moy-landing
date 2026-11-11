// POST /api/leads — заявка с сайта или из Mini App.
// Ответ 201 { number, telegramLink }: telegramLink — ссылка в бота, чтобы клиент с сайта получил ответ в Telegram
// (у клиента из Mini App чат и так известен, для него null).

import { AuthError, getBotToken, getOwnerId, telegramUserFromRequest } from "../lib/auth.mjs";
import {
  corsHeaders,
  errorResponse,
  getAllowedOrigins,
  isAllowedOrigin,
  jsonResponse,
  preflightResponse,
  readJsonBody,
  RequestValidationError,
} from "../lib/http.mjs";
import { getServices } from "../lib/content.mjs";
import { createLead, notifyOwner, validateLeadInput } from "../lib/leads.mjs";
import { getSalt, hitRateLimit } from "../lib/ratelimit.mjs";
import { openStore } from "../lib/store.mjs";
import { createTelegram } from "../lib/telegram.mjs";

export const LEADS_PER_HOUR = 5;

export function botUsername(env = process.env) {
  return env.TELEGRAM_BOT_USERNAME?.trim() || "stvnislv_bot";
}

/** ip — адрес клиента (его определяет сервер); telegram и now подменяются в тестах. */
export async function createLeadHandler(request, { ip = null, env = process.env, telegram, now = new Date() } = {}) {
  const origins = getAllowedOrigins(env);
  const preflight = preflightResponse(request, origins);
  if (preflight) return preflight;
  const cors = corsHeaders(request, origins);
  if (request.method !== "POST") return jsonResponse({ error: "Метод не поддерживается." }, 405, cors);
  if (!isAllowedOrigin(request, origins)) return jsonResponse({ error: "Запрос отклонён." }, 403, cors);

  try {
    let telegramUser = null;
    try {
      telegramUser = telegramUserFromRequest(request, env, { now: now.getTime() })?.user ?? null;
    } catch (error) {
      if (error instanceof AuthError) return jsonResponse({ error: error.message }, 403, cors);
      throw error;
    }

    const services = await getServices();
    const input = validateLeadInput(await readJsonBody(request), { services, telegramUser });

    const subject = telegramUser ? `tg:${telegramUser.id}` : ip ? `ip:${ip}` : null;
    if (!subject) throw new Error("Не удалось определить адрес клиента.");
    const allowed = await hitRateLimit(await openStore("meta", env), {
      subject,
      salt: getSalt(env),
      limit: LEADS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
      now: now.getTime(),
    });
    if (!allowed) {
      throw new RequestValidationError("Слишком много заявок подряд. Попробуйте через час или напишите мне в Telegram.", 429);
    }

    const lead = await createLead(input, { source: telegramUser ? "miniapp" : "site", telegramUser, now, env });
    await notifyOwner(lead, {
      telegram: telegram ?? createTelegram(getBotToken(env)),
      ownerId: getOwnerId(env),
      services,
      env,
    });

    return jsonResponse({
      number: lead.number,
      telegramLink: lead.tg ? null : `https://t.me/${botUsername(env)}?start=l_${lead.linkToken}`,
    }, 201, cors);
  } catch (error) {
    return errorResponse(error, cors);
  }
}
