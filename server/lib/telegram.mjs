// Telegram Bot API без библиотек. Токен никогда не попадает в тексты ошибок и логи.

const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;
export const MESSAGE_MAX_LENGTH = 4096;

export class TelegramError extends Error {
  /** code — HTTP-код или error_code Telegram (403 — бот заблокирован, 429 — слишком часто). */
  constructor(method, code, description, retryAfter) {
    super(`Telegram ${method}: ${code}${description ? ` ${description}` : ""}`);
    this.method = method;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** Экранирование для parse_mode: "HTML" — всё, что пришло от клиента, проходит через неё. */
export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Обрезать текст до лимита Telegram, не разрывая пару UTF-16 (эмодзи). */
export function truncate(text, max = MESSAGE_MAX_LENGTH) {
  const chars = [...String(text)];
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
}

export function createTelegram(token, { fetchImpl = globalThis.fetch } = {}) {
  const hide = (text) => String(text).split(token).join("<токен>");

  async function call(method, params = {}) {
    let response;
    try {
      response = await fetchImpl(`${API}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new TelegramError(method, "network_error", hide(error?.cause?.code ?? error?.name ?? ""));
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new TelegramError(method, response.status, "ответ не JSON");
    }
    if (!body?.ok) {
      throw new TelegramError(method, body?.error_code ?? response.status, hide(body?.description ?? ""), body?.parameters?.retry_after);
    }
    return body.result;
  }

  return {
    call,
    sendMessage: (chatId, text, extra = {}) =>
      call("sendMessage", { chat_id: chatId, text: truncate(text), parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra }),
    editMessageText: (chatId, messageId, text, extra = {}) =>
      call("editMessageText", { chat_id: chatId, message_id: messageId, text: truncate(text), parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra }),
    // Копия сообщения в другой чат — любого типа (текст, фото, файл, голосовое), без подписи «Переслано от».
    copyMessage: (chatId, fromChatId, messageId) =>
      call("copyMessage", { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId }),
    // Реакция на сообщение (например, 👍 — «доставлено»).
    setMessageReaction: (chatId, messageId, emoji) =>
      call("setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] }),
    answerCallbackQuery: (callbackQueryId, text) =>
      call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
    setWebhook: (url, secretToken, allowedUpdates = ["message", "callback_query"]) =>
      call("setWebhook", { url, secret_token: secretToken, allowed_updates: allowedUpdates, drop_pending_updates: false }),
    getWebhookInfo: () => call("getWebhookInfo"),
  };
}
