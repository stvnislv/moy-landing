// Простой бот @stvnislv_bot: отвечает на /start, /help и /contact.
// Работает на Маке через long polling — сам спрашивает Telegram о новых сообщениях, сервер и вебхук не нужны.
// Без внешних библиотек: нужен только Node.js (стоит в ~/.local/node).
//
// Запуск из корня проекта:
//   export PATH=~/.local/node/bin:$PATH
//   node bot/bot.mjs
// Остановка — Ctrl+C в том же окне Терминала.
//
// Токен — TELEGRAM_BOT_TOKEN в ../.env. Бот его никуда не выводит.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Адрес Mini App, который открывает кнопка «Открыть приложение». Тот же, что у кнопки меню бота в @BotFather.
const APP_URL = "https://stvnislv-app.netlify.app/";
const AUTHOR = "@stvnislvvv";

const appButton = { inline_keyboard: [[{ text: "Открыть приложение", web_app: { url: APP_URL } }]] };

// Ответы. name — имя человека из Telegram (может не быть).
const replies = {
  start: (name) => ({
    text:
      `Привет${name ? `, ${name}` : ""}! Я Stvnislv, делаю сайты, лендинги и Telegram-приложения с помощью ИИ. ` +
      "Здесь можно посмотреть услуги и цены, мои работы и сразу написать мне.",
    reply_markup: appButton,
  }),
  help: () => ({
    text:
      "Вот что я умею:\n" +
      "/start — открыть приложение с услугами, ценами и работами\n" +
      `/contact — написать автору напрямую\n\n` +
      "Или просто нажмите кнопку ниже.",
    reply_markup: appButton,
  }),
  contact: () => ({ text: `Напишите мне: ${AUTHOR}` }),
};

// --- токен из .env ---
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
let token = "";
try {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(.*?)\s*$/);
    if (m) token = m[1].replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("Не найден файл .env в корне проекта.");
  process.exit(1);
}
if (!/^\d+:[\w-]{30,}$/.test(token)) {
  console.error("В .env нет TELEGRAM_BOT_TOKEN (или он записан с ошибкой). Добавьте строку:\nTELEGRAM_BOT_TOKEN=<токен из @BotFather>");
  process.exit(1);
}
const hide = (text) => String(text).split(token).join("<токен>");   // на всякий случай: токен не попадёт в вывод

// --- Bot API ---
async function api(method, params = {}, signal) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) {
    const err = new Error(`${method}: ${body.description || `HTTP ${res.status}`}`);
    err.code = body.error_code || res.status;
    throw err;
  }
  return body.result;
}

// Какая команда в сообщении: "/start", "/start from_app", "/help@stvnislv_bot" → start / help.
function commandOf(message) {
  const m = (message.text || "").match(/^\/([a-z]+)(?:@\w+)?(?:\s|$)/i);
  return m ? m[1].toLowerCase() : null;
}

async function handle(update) {
  const message = update.message;
  if (!message || !message.chat) return;
  const cmd = commandOf(message);
  if (!cmd || !Object.hasOwn(replies, cmd)) return;     // всё остальное бот пропускает молча
  const reply = replies[cmd];
  const name = message.from && message.from.first_name ? message.from.first_name : "";
  await api("sendMessage", { chat_id: message.chat.id, ...reply(name) });
  console.log(`${new Date().toLocaleTimeString("ru-RU")}  ответил на /${cmd}`);
}

// --- запуск ---
const controller = new AbortController();
let running = true;
process.on("SIGINT", () => {                            // Ctrl+C
  running = false;
  controller.abort();
  console.log("\nБот остановлен.");
  process.exit(0);
});

try {
  const me = await api("getMe");
  // long polling не работает, если у бота включён вебхук, — проверяем и предупреждаем
  const hook = await api("getWebhookInfo");
  if (hook.url) {
    console.error("У бота включён вебхук, поэтому long polling не заработает. Ничего не менял — скажите Claude, что делать.");
    process.exit(1);
  }
  console.log(`Бот @${me.username} запущен. Напишите ему в Telegram /start. Остановить — Ctrl+C.`);
} catch (e) {
  console.error(`Не получилось запустить: ${hide(e.message)}${e.cause ? ` (${e.cause.code || e.cause.name})` : ""}. Возможно, нужен VPN.`);
  process.exit(1);
}

let offset = 0;
while (running) {
  try {
    // Ждём новые сообщения до 30 секунд; пришло — сразу отвечаем.
    const updates = await api("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] }, controller.signal);
    for (const update of updates) {
      offset = update.update_id + 1;
      try { await handle(update); } catch (e) { console.error(`Не смог ответить: ${hide(e.message)}`); }
    }
  } catch (e) {
    if (!running) break;
    if (e.code === 409) {
      console.error("Этот бот уже запущен в другом окне или на другом компьютере. Остановите его там и запустите снова.");
      process.exit(1);
    }
    console.error(`Нет связи с Telegram (${hide(e.message)}${e.cause ? `, ${e.cause.code || e.cause.name}` : ""}). Повторю через 5 секунд…`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
