// POST /api/telegram — webhook бота @stvnislv_bot: Telegram присылает сюда всё, что происходит в боте.
//
// Что умеет сейчас:
//   • кнопки «Новая» / «В работе» / «Готово» под уведомлением о заявке — меняют статус (только владелец);
//   • /start, /help, /contact — те же ответы, что были у bot/bot.mjs;
//   • /start l_<токен> — клиент с сайта подключает Telegram к своей заявке, чтобы получить ответ.
// Пересылка сообщений между владельцем и клиентом — следующий шаг (BACKEND-PLAN.md, этап 3).
//
// Telegram всегда получает 200: иначе он повторяет одно и то же обновление снова и снова.

import { getBotToken, getOwnerId, isTelegramWebhook } from "../lib/auth.mjs";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/http.mjs";
import { getServices } from "../lib/content.mjs";
import { escapeHtml, createTelegram, TelegramError } from "../lib/telegram.mjs";
import { formatLeadForOwner, linkChatToLead, setLeadStatus, STATUSES, statusKeyboard } from "../lib/leads.mjs";

// Адрес Mini App для кнопки «Открыть приложение» — тот же, что у кнопки меню бота в @BotFather.
export const APP_URL = "https://stvnislv-app.netlify.app/";
const AUTHOR = "@stvnislvvv";
const appButton = { inline_keyboard: [[{ text: "Открыть приложение", web_app: { url: APP_URL } }]] };

export const replies = {
  start: (name) => ({
    text:
      `Привет${name ? `, ${escapeHtml(name)}` : ""}! Я Stvnislv, делаю сайты, лендинги и Telegram-приложения с помощью ИИ. ` +
      "Здесь можно посмотреть услуги и цены, мои работы и сразу написать мне.",
    reply_markup: appButton,
  }),
  help: () => ({
    text:
      "Вот что я умею:\n" +
      "/start — открыть приложение с услугами, ценами и работами\n" +
      "/contact — написать автору напрямую\n\n" +
      "Или просто нажмите кнопку ниже.",
    reply_markup: appButton,
  }),
  contact: () => ({ text: `Напишите мне: ${AUTHOR}` }),
};

/** Команда и её параметр: "/start l_abc" → ["start", "l_abc"]; "/help@stvnislv_bot" → ["help", ""]. */
export function parseCommand(text) {
  const match = /^\/([a-z]+)(?:@\w+)?(?:\s+(\S+))?/i.exec(text ?? "");
  return match ? [match[1].toLowerCase(), match[2] ?? ""] : [null, ""];
}

async function handleCallback(query, { telegram, env, now }) {
  const match = /^st:([0-9a-f-]{36}):([a-z_]+)$/.exec(query.data ?? "");
  if (!match || !Object.hasOwn(STATUSES, match[2])) {
    await telegram.answerCallbackQuery(query.id);
    return;
  }
  if (query.from?.id !== getOwnerId(env)) {
    await telegram.answerCallbackQuery(query.id, "Менять статус может только владелец.");
    return;
  }

  const lead = await setLeadStatus(match[1], match[2], { now, env });
  if (!lead) {
    await telegram.answerCallbackQuery(query.id, "Заявка не найдена — возможно, её удалили.");
    return;
  }
  // Ответ на нажатие убирает «часики» на кнопке и показывает короткую подсказку.
  await telegram.answerCallbackQuery(query.id, `Статус: ${STATUSES[lead.status]}`);
  if (query.message) {
    try {
      await telegram.editMessageText(query.message.chat.id, query.message.message_id,
        formatLeadForOwner(lead, await getServices()), { reply_markup: statusKeyboard(lead) });
    } catch (error) {
      // «message is not modified» — текст уже такой (нажали ту же кнопку дважды). Не ошибка.
      if (!(error instanceof TelegramError && error.code === 400)) throw error;
    }
  }
}

async function handleMessage(message, { telegram, env, now }) {
  if (message.chat?.type !== "private") return;           // в группах бот молчит
  const [command, payload] = parseCommand(message.text);
  const chatId = message.chat.id;
  const name = message.from?.first_name ?? "";

  if (command === "start" && payload.startsWith("l_")) {
    const lead = await linkChatToLead(payload.slice(2), message.from, chatId, { now, env });
    if (!lead) {
      await telegram.sendMessage(chatId, "Ссылка устарела или неверная. Напишите мне напрямую: " + AUTHOR);
      return;
    }
    await telegram.sendMessage(chatId,
      `Готово! Ответ по заявке №${lead.number} придёт сюда, в этот чат.`, { reply_markup: appButton });
    await telegram.sendMessage(getOwnerId(env),
      `🔗 Клиент по заявке №${lead.number} подключил Telegram — теперь ему можно ответить через бота.`);
    return;
  }
  if (command && Object.hasOwn(replies, command)) {
    const reply = replies[command](name);
    await telegram.sendMessage(chatId, reply.text, { reply_markup: reply.reply_markup });
  }
  // Остальные сообщения пока без ответа — как раньше у bot/bot.mjs.
}

export async function telegramWebhookHandler(request, { env = process.env, telegram, now = new Date() } = {}) {
  if (request.method !== "POST") return jsonResponse({ error: "Метод не поддерживается." }, 405);
  if (!isTelegramWebhook(request, env)) return jsonResponse({ error: "Запрос отклонён." }, 401);

  let update;
  try {
    update = await readJsonBody(request, { maxBytes: 256 * 1024 });
  } catch (error) {
    return errorResponse(error);
  }

  const context = { telegram: telegram ?? createTelegram(getBotToken(env)), env, now };
  try {
    if (update?.callback_query) await handleCallback(update.callback_query, context);
    else if (update?.message) await handleMessage(update.message, context);
  } catch (error) {
    console.error("Ошибка обработки обновления Telegram:", { update: update?.update_id, error: error?.message });
  }
  return jsonResponse({ ok: true });
}
