// Настройка бота @stvnislv_bot через Telegram Bot API: описание, короткое описание и команды.
// Токен берётся из ../.env (переменная TELEGRAM_BOT_TOKEN) и никуда не выводится.
//
// Запуск из корня проекта:
//   export PATH=~/.local/node/bin:$PATH
//   node scripts/setup-telegram-bot.mjs           — установить и показать, что получилось
//   node scripts/setup-telegram-bot.mjs --check   — только показать, что сейчас стоит у бота
//
// Тексты — ниже, в BOT. Лимиты Telegram: описание до 512 символов, короткое — до 120,
// команда — латиница/цифры/_ до 32 символов, её описание — от 3 до 256.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BOT = {
  username: "stvnislv_bot",
  description:
    "Привет! Я делаю сайты, лендинги и Telegram-приложения с помощью ИИ. " +
    "Здесь — мини-приложение: услуги с ценами, примеры работ и кнопка, чтобы сразу мне написать. " +
    "Нажмите «Запустить», а потом кнопку приложения слева от поля ввода.",
  shortDescription: "Сайты, лендинги и Telegram-приложения с помощью ИИ — услуги, работы и связь со мной.",
  commands: [
    { command: "start", description: "Открыть приложение" },
    { command: "help", description: "Что умеет бот и как им пользоваться" },
    { command: "contact", description: "Написать автору — @stvnislvvv" },
  ],
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

// --- вызов Bot API; токен не попадает ни в вывод, ни в тексты ошибок ---
async function api(method, params = {}) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (e) {
    throw new Error(`${method}: нет связи с api.telegram.org (${e.cause?.code || e.name}). Возможно, нужен VPN.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`${method}: ${body.description || `HTTP ${res.status}`}`);
  return body.result;
}

const checkOnly = process.argv.includes("--check");
try {
  const me = await api("getMe");
  if (me.username.toLowerCase() !== BOT.username) {
    throw new Error(`Токен от другого бота: @${me.username}, а ожидался @${BOT.username}. Ничего не менял.`);
  }
  console.log(`Бот: @${me.username} (${me.first_name})`);

  if (!checkOnly) {
    await api("setMyDescription", { description: BOT.description });
    await api("setMyShortDescription", { short_description: BOT.shortDescription });
    await api("setMyCommands", { commands: BOT.commands });
    console.log("Установлено: описание, короткое описание, команды.\n");
  }

  const { description } = await api("getMyDescription");
  const { short_description } = await api("getMyShortDescription");
  const commands = await api("getMyCommands");
  const menu = await api("getChatMenuButton");
  console.log(`Описание:\n  ${description || "(пусто)"}\n`);
  console.log(`Короткое описание:\n  ${short_description || "(пусто)"}\n`);
  console.log("Команды:");
  for (const c of commands) console.log(`  /${c.command} — ${c.description}`);
  console.log(`\nКнопка меню: ${menu.type === "web_app" ? `«${menu.text}» → ${menu.web_app.url}` : menu.type}`);
} catch (e) {
  console.error(`Ошибка: ${e.message}`);
  process.exit(1);
}
