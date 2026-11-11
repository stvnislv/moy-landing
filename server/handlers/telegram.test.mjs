import assert from "node:assert/strict";
import test from "node:test";
import { openStore, useMemoryStoresForTests } from "../lib/store.mjs";
import { createLead } from "../lib/leads.mjs";
import { TelegramError } from "../lib/telegram.mjs";
import { parseCommand, telegramWebhookHandler } from "./telegram.mjs";

const SECRET = "w".repeat(40);
const OWNER = 288440954;
const env = { TELEGRAM_BOT_TOKEN: "123456789:AAtest-token-for-unit-tests-only-xxxxx", OWNER_TELEGRAM_ID: String(OWNER), TELEGRAM_WEBHOOK_SECRET: SECRET };
const NOW = new Date(Date.UTC(2026, 10, 11, 15));

function fakeTelegram({ editError } = {}) {
  const calls = [];
  return {
    calls,
    async sendMessage(chatId, text, extra) { calls.push({ method: "sendMessage", chatId, text, extra }); return { message_id: 900 + calls.length }; },
    async editMessageText(chatId, messageId, text, extra) {
      calls.push({ method: "editMessageText", chatId, messageId, text, extra });
      if (editError) throw editError;
      return true;
    },
    async answerCallbackQuery(id, text) { calls.push({ method: "answerCallbackQuery", id, text }); return true; },
  };
}

const update = (body, secret = SECRET) => new Request("http://localhost/api/telegram", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
  body: JSON.stringify(body),
});

async function newLead() {
  return createLead({
    serviceId: "sites", task: "Лендинг", budget: "30_60", deadline: "2w",
    contact: { name: "Анна", method: "email", value: "anna@example.com" },
  }, { source: "site", now: NOW, env });
}

const press = (lead, status, fromId = OWNER) => ({
  update_id: 1,
  callback_query: {
    id: "cb1",
    from: { id: fromId },
    data: `st:${lead.id}:${status}`,
    message: { message_id: 55, chat: { id: OWNER } },
  },
});

test.beforeEach(() => useMemoryStoresForTests());

test("without the webhook secret the request is rejected", async () => {
  const telegram = fakeTelegram();
  assert.equal((await telegramWebhookHandler(update({}, "x".repeat(40)), { env, telegram })).status, 401);
  assert.equal((await telegramWebhookHandler(new Request("http://localhost/api/telegram"), { env, telegram })).status, 405);
  assert.equal(telegram.calls.length, 0);
});

test("the owner presses «В работе»: status changes, message updates, button stops spinning", async () => {
  const lead = await newLead();
  const telegram = fakeTelegram();
  const response = await telegramWebhookHandler(update(press(lead, "in_progress")), { env, telegram, now: NOW });
  assert.equal(response.status, 200);

  const [answer, edit] = telegram.calls;
  assert.deepEqual(answer, { method: "answerCallbackQuery", id: "cb1", text: "Статус: В работе" });
  assert.equal(edit.method, "editMessageText");
  assert.equal(edit.messageId, 55);
  assert.match(edit.text, /🛠 <b>Заявка №1<\/b>/);
  assert.match(edit.text, /Статус:<\/b> В работе/);
  assert.deepEqual(edit.extra.reply_markup.inline_keyboard[0].map((b) => b.text), ["Новая", "Готово"]);

  const leads = await openStore("leads");
  assert.equal((await leads.get(`lead/${lead.id}`)).value.status, "in_progress");
  assert.equal((await leads.get("index")).value[0].status, "in_progress");
});

test("«Готово» sets doneAt; going back clears it", async () => {
  const lead = await newLead();
  const telegram = fakeTelegram();
  await telegramWebhookHandler(update(press(lead, "done")), { env, telegram, now: NOW });
  const leads = await openStore("leads");
  assert.equal((await leads.get(`lead/${lead.id}`)).value.doneAt, NOW.toISOString());
  await telegramWebhookHandler(update(press(lead, "new")), { env, telegram, now: NOW });
  assert.equal((await leads.get(`lead/${lead.id}`)).value.doneAt, null);
});

test("someone else cannot change the status", async () => {
  const lead = await newLead();
  const telegram = fakeTelegram();
  await telegramWebhookHandler(update(press(lead, "done", 12345)), { env, telegram, now: NOW });
  assert.deepEqual(telegram.calls, [{ method: "answerCallbackQuery", id: "cb1", text: "Менять статус может только владелец." }]);
  assert.equal((await (await openStore("leads")).get(`lead/${lead.id}`)).value.status, "new");
});

test("unknown or deleted lead, bad button data, and «message is not modified» are handled calmly", async () => {
  const telegram = fakeTelegram();
  await telegramWebhookHandler(update(press({ id: "00000000-0000-4000-8000-000000000000" }, "done")), { env, telegram });
  assert.match(telegram.calls[0].text, /не найдена/);

  const bad = fakeTelegram();
  await telegramWebhookHandler(update({ callback_query: { id: "x", from: { id: OWNER }, data: "st:../../x:done" } }), { env, telegram: bad });
  assert.deepEqual(bad.calls, [{ method: "answerCallbackQuery", id: "x", text: undefined }]);

  const lead = await newLead();
  const notModified = fakeTelegram({ editError: new TelegramError("editMessageText", 400, "message is not modified") });
  const response = await telegramWebhookHandler(update(press(lead, "done")), { env, telegram: notModified, now: NOW });
  assert.equal(response.status, 200);
});

test("errors inside still answer 200 so Telegram does not resend the update forever", async () => {
  const lead = await newLead();
  const broken = { ...fakeTelegram(), answerCallbackQuery: async () => { throw new Error("network"); } };
  const response = await telegramWebhookHandler(update(press(lead, "done")), { env, telegram: broken, now: NOW });
  assert.equal(response.status, 200);
});

test("/start, /help, /contact answer like the old bot; groups are ignored", async () => {
  const telegram = fakeTelegram();
  const msg = (text, type = "private") => ({ update_id: 2, message: { text, chat: { id: 777, type }, from: { id: 777, first_name: "Олег <b>" } } });
  await telegramWebhookHandler(update(msg("/start")), { env, telegram });
  await telegramWebhookHandler(update(msg("/help@stvnislv_bot")), { env, telegram });
  await telegramWebhookHandler(update(msg("/contact")), { env, telegram });
  await telegramWebhookHandler(update(msg("/start", "group")), { env, telegram });
  await telegramWebhookHandler(update(msg("привет")), { env, telegram });
  assert.equal(telegram.calls.length, 3);
  assert.match(telegram.calls[0].text, /^Привет, Олег &lt;b&gt;!/);
  assert.equal(telegram.calls[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, "https://stvnislv-app.netlify.app/");
  assert.match(telegram.calls[1].text, /Вот что я умею/);
  assert.equal(telegram.calls[2].text, "Напишите мне: @stvnislvvv");
});

test("/start l_<token> links the client's chat to the lead and tells the owner", async () => {
  const lead = await newLead();
  const telegram = fakeTelegram();
  const msg = { update_id: 3, message: { text: `/start l_${lead.linkToken}`, chat: { id: 555, type: "private" }, from: { id: 555, first_name: "Анна", username: "anna_tg" } } };
  await telegramWebhookHandler(update(msg), { env, telegram, now: NOW });
  assert.equal(telegram.calls[0].chatId, 555);
  assert.match(telegram.calls[0].text, /заявке №1 придёт сюда/);
  assert.equal(telegram.calls[1].chatId, OWNER);
  assert.match(telegram.calls[1].text, /подключил Telegram/);

  const leads = await openStore("leads");
  const saved = (await leads.get(`lead/${lead.id}`)).value;
  assert.equal(saved.canMessage, true);
  assert.deepEqual(saved.tg, { userId: 555, chatId: 555, username: "anna_tg", firstName: "Анна" });
  assert.deepEqual((await leads.get("tg-chat/555")).value, { leadId: lead.id });

  const wrong = fakeTelegram();
  await telegramWebhookHandler(update({ message: { ...msg.message, text: "/start l_AAAAAAAAAAAAAAAAAAAAAA" } }), { env, telegram: wrong });
  assert.match(wrong.calls[0].text, /устарела или неверная/);
});

test("parseCommand", () => {
  assert.deepEqual(parseCommand("/start l_abc"), ["start", "l_abc"]);
  assert.deepEqual(parseCommand("/HELP@stvnislv_bot"), ["help", ""]);
  assert.deepEqual(parseCommand("привет"), [null, ""]);
  assert.deepEqual(parseCommand(undefined), [null, ""]);
});
