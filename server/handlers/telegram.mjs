// POST /api/telegram — webhook бота @stvnislv_bot: Telegram присылает сюда всё, что происходит в боте.
//
// Что умеет сейчас:
//   • кнопки «Новая» / «В работе» / «Готово» под уведомлением о заявке — меняют статус (только владелец);
//   • /start, /help, /contact — те же ответы, что были у bot/bot.mjs;
//   • /start l_<токен> — клиент с сайта подключает Telegram к своей заявке, чтобы получить ответ;
//   • переписка: владелец отвечает («Ответить») на уведомление или сообщение клиента — бот копирует ответ клиенту
//     (текст, фото, файлы, голосовые) и ставит 👍; клиент пишет боту — сообщение приходит владельцу с номером заявки.
//
// Telegram всегда получает 200: иначе он повторяет одно и то же обновление снова и снова.

import { getBotToken, getOwnerId, isTelegramWebhook } from "../lib/auth.mjs";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/http.mjs";
import { getServices } from "../lib/content.mjs";
import { escapeHtml, createTelegram, TelegramError } from "../lib/telegram.mjs";
import {
  addLeadMessage,
  contactLine,
  findLeadByChat,
  findLeadByOwnerMessage,
  formatLeadForOwner,
  linkChatToLead,
  mapOwnerMessage,
  markUnreachable,
  messageSummary,
  setLeadStatus,
  STATUSES,
  statusKeyboard,
} from "../lib/leads.mjs";

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

async function handleMessage(message, context) {
  const { telegram, env, now } = context;
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
      `Готово! Ответ по заявке №${lead.number} придёт сюда, в этот чат. Можете сразу написать здесь, если хотите что-то добавить.`,
      { reply_markup: appButton });
    const note = await telegram.sendMessage(getOwnerId(env),
      `🔗 Клиент по заявке №${lead.number} подключил Telegram — ответьте на это сообщение, и ответ уйдёт ему через бота.`);
    await mapOwnerMessage(note.message_id, lead.id, env);
    return;
  }
  if (command) {
    if (Object.hasOwn(replies, command)) {
      const reply = replies[command](name);
      await telegram.sendMessage(chatId, reply.text, { reply_markup: reply.reply_markup });
    }
    return;                                                // незнакомые команды — без ответа
  }

  if (message.from?.id === getOwnerId(env)) await handleOwnerMessage(message, context);
  else await handleClientMessage(message, context);
}

// Владелец отвечает клиенту: «Ответить» на уведомление о заявке или на сообщение клиента.
async function handleOwnerMessage(message, { telegram, env, now }) {
  const ownerChat = message.chat.id;
  const repliedTo = message.reply_to_message?.message_id;
  if (!repliedTo) {
    await telegram.sendMessage(ownerChat,
      "Чтобы ответить клиенту, нажмите на уведомление о заявке или на его сообщение и выберите «Ответить» — ответ уйдёт ему через бота.");
    return;
  }
  const lead = await findLeadByOwnerMessage(repliedTo, env);
  if (!lead) {
    await telegram.sendMessage(ownerChat,
      "Не нашёл заявку для этого сообщения. Ответьте на уведомление о заявке или на сообщение клиента.",
      { reply_parameters: { message_id: message.message_id } });
    return;
  }
  if (!lead.tg?.chatId || !lead.canMessage) {
    await telegram.sendMessage(ownerChat,
      `Клиенту по заявке №${lead.number} нельзя написать через бота: он не подключил Telegram. Свяжитесь сами — ${escapeHtml(contactLine(lead))}`,
      { reply_parameters: { message_id: message.message_id } });
    return;
  }

  try {
    await telegram.copyMessage(lead.tg.chatId, ownerChat, message.message_id);
  } catch (error) {
    // 403 — клиент заблокировал бота; 400 «chat not found» — чата больше нет.
    if (error instanceof TelegramError && (error.code === 403 || error.code === 400)) {
      await markUnreachable(lead.id, { env });
      await telegram.sendMessage(ownerChat,
        `Не доставлено: клиент по заявке №${lead.number} закрыл чат с ботом. Свяжитесь сами — ${escapeHtml(contactLine(lead))}`,
        { reply_parameters: { message_id: message.message_id } });
      return;
    }
    throw error;
  }
  await addLeadMessage(lead.id, "owner", messageSummary(message), { now, env });
  try {
    await telegram.setMessageReaction(ownerChat, message.message_id, "👍");   // «доставлено»
  } catch {
    await telegram.sendMessage(ownerChat, "✓ Отправлено", { reply_parameters: { message_id: message.message_id } });
  }
}

// Клиент пишет боту — сообщение уходит владельцу с номером заявки.
async function handleClientMessage(message, { telegram, env, now }) {
  const lead = await findLeadByChat(message.chat.id, env);
  if (!lead) {
    await telegram.sendMessage(message.chat.id,
      `Чтобы обсудить проект, оставьте заявку в приложении — кнопка ниже — или напишите мне напрямую: ${AUTHOR}`,
      { reply_markup: appButton });
    return;
  }

  const ownerId = getOwnerId(env);
  const header = `💬 <b>Заявка №${lead.number}</b> · ${escapeHtml(lead.contact.name || message.from?.first_name || "клиент")}`;
  const sent = [];
  if (message.text) {
    sent.push(await telegram.sendMessage(ownerId, `${header}\n\n${escapeHtml(message.text)}`));
  } else {
    sent.push(await telegram.sendMessage(ownerId, `${header} — вложение:`));
    sent.push(await telegram.copyMessage(ownerId, message.chat.id, message.message_id));
  }
  for (const item of sent) await mapOwnerMessage(item.message_id, lead.id, env);
  await addLeadMessage(lead.id, "client", messageSummary(message), { now, env });
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
