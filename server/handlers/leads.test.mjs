import assert from "node:assert/strict";
import test from "node:test";
import { signInitData } from "../lib/auth.mjs";
import { openStore, useMemoryStoresForTests } from "../lib/store.mjs";
import { createLeadHandler } from "./leads.mjs";

const TOKEN = "123456789:AAtest-token-for-unit-tests-only-xxxxx";
const SITE = "https://stvnislv.netlify.app";
const env = {
  TELEGRAM_BOT_TOKEN: TOKEN,
  OWNER_TELEGRAM_ID: "288440954",
  ALLOWED_ORIGINS: `${SITE},https://stvnislv-app.netlify.app`,
  IP_HASH_SALT: "salt-for-tests-0123456789",
};
const NOW = new Date(Date.UTC(2026, 10, 11, 12));

const validBody = {
  serviceId: "sites",
  task: "Нужен лендинг для студии <йоги> & растяжки",
  budget: "30_60",
  deadline: "2w",
  name: "Анна",
  contactMethod: "email",
  contact: "anna@example.com",
  consent: true,
  website: "",
};

function fakeTelegram({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendMessage(chatId, text, extra) {
      if (fail) throw Object.assign(new Error("Telegram sendMessage: network_error"), { code: "network_error" });
      sent.push({ chatId, text, extra });
      return { message_id: 100 + sent.length };
    },
  };
}

function post(body, { origin = SITE, headers = {} } = {}) {
  return new Request("http://localhost/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...headers },
    body: JSON.stringify(body),
  });
}

test.beforeEach(() => useMemoryStoresForTests());

test("a site lead is saved, numbered, indexed, and sent to the owner with escaped text", async () => {
  const telegram = fakeTelegram();
  const response = await createLeadHandler(post(validBody), { ip: "203.0.113.5", env, telegram, now: NOW });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), SITE);
  const result = await response.json();
  assert.equal(result.number, 1);
  assert.match(result.telegramLink, /^https:\/\/t\.me\/stvnislv_bot\?start=l_[A-Za-z0-9_-]{22}$/);

  assert.equal(telegram.sent.length, 1);
  assert.equal(telegram.sent[0].chatId, 288440954);
  assert.match(telegram.sent[0].text, /Заявка №1<\/b> · сайт/);
  assert.match(telegram.sent[0].text, /студии &lt;йоги&gt; &amp; растяжки/);
  assert.deepEqual(telegram.sent[0].extra.reply_markup.inline_keyboard[0].map((b) => b.text), ["В работе", "Готово"]);

  const leads = await openStore("leads");
  const [row] = (await leads.get("index")).value;
  const lead = (await leads.get(`lead/${row.id}`)).value;
  assert.equal(lead.status, "new");
  assert.equal(lead.source, "site");
  assert.equal(lead.notified, true);
  assert.equal(lead.ownerMessageId, 101);
  assert.equal(lead.canMessage, false);
  assert.deepEqual(lead.contact, { name: "Анна", method: "email", value: "anna@example.com" });
  assert.equal(lead.website, undefined);
  assert.deepEqual((await leads.get("tg-msg/101")).value, { leadId: lead.id });
  assert.deepEqual((await leads.get(`link/${result.telegramLink.split("l_")[1]}`)).value, { leadId: lead.id });

  const second = await createLeadHandler(post(validBody), { ip: "203.0.113.6", env, telegram, now: NOW });
  assert.equal((await second.json()).number, 2);
  assert.deepEqual((await leads.get("index")).value.map((r) => r.number), [2, 1]);
});

test("a Mini App lead uses the verified Telegram user and needs no contact", async () => {
  const initData = signInitData({
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 10),
    user: JSON.stringify({ id: 555, first_name: "Олег", username: "oleg_tg", allows_write_to_pm: true }),
  }, TOKEN);
  const telegram = fakeTelegram();
  const body = { ...validBody, contactMethod: "telegram", contact: "", name: "Олег" };
  const response = await createLeadHandler(
    post(body, { origin: "https://stvnislv-app.netlify.app", headers: { Authorization: `tma ${initData}` } }),
    { ip: "203.0.113.5", env, telegram, now: NOW },
  );
  assert.equal(response.status, 201);
  assert.equal((await response.json()).telegramLink, null);
  const leads = await openStore("leads");
  const lead = (await leads.get(`lead/${(await leads.get("index")).value[0].id}`)).value;
  assert.equal(lead.source, "miniapp");
  assert.equal(lead.canMessage, true);
  assert.deepEqual(lead.tg, { userId: 555, chatId: 555, username: "oleg_tg", firstName: "Олег" });
  assert.equal(lead.contact.value, "@oleg_tg");
  assert.match(telegram.sent[0].text, /Mini App/);
});

test("writeAccess from the Mini App marks the client as reachable; from the site it is ignored", async () => {
  const initData = signInitData({
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 10),
    user: JSON.stringify({ id: 777, first_name: "Ира", allows_write_to_pm: false }),
  }, TOKEN);
  const telegram = fakeTelegram();
  const leads = await openStore("leads");
  const tgBody = { ...validBody, contactMethod: "telegram", contact: "", writeAccess: true };
  await createLeadHandler(post(tgBody, { headers: { Authorization: `tma ${initData}` } }), { ip: "1.1.1.1", env, telegram, now: NOW });
  const fromApp = (await leads.get(`lead/${(await leads.get("index")).value[0].id}`)).value;
  assert.equal(fromApp.canMessage, true);
  assert.equal(fromApp.contact.value, "");          // ника нет — ответ по Telegram ID
  assert.equal("writeAccess" in fromApp, false);

  await createLeadHandler(post({ ...validBody, writeAccess: true }), { ip: "1.1.1.2", env, telegram, now: NOW });
  const fromSite = (await leads.get(`lead/${(await leads.get("index")).value[0].id}`)).value;
  assert.equal(fromSite.canMessage, false);
});

test("forged initData is rejected with 403", async () => {
  const forged = signInitData({ auth_date: String(Math.floor(NOW.getTime() / 1000)), user: JSON.stringify({ id: 1 }) },
    "999999999:AAforged-token-xxxxxxxxxxxxxxxxxxxxxxx");
  const response = await createLeadHandler(post(validBody, { headers: { Authorization: `tma ${forged}` } }), { ip: "1.1.1.1", env, telegram: fakeTelegram(), now: NOW });
  assert.equal(response.status, 403);
});

test("foreign or missing Origin, wrong method, preflight", async () => {
  const telegram = fakeTelegram();
  assert.equal((await createLeadHandler(post(validBody, { origin: "https://evil.example" }), { ip: "1.1.1.1", env, telegram })).status, 403);
  assert.equal((await createLeadHandler(post(validBody, { origin: null }), { ip: "1.1.1.1", env, telegram })).status, 403);
  assert.equal((await createLeadHandler(new Request("http://localhost/api/leads", { headers: { Origin: SITE } }), { env, telegram })).status, 405);
  const preflight = await createLeadHandler(new Request("http://localhost/api/leads", { method: "OPTIONS", headers: { Origin: SITE } }), { env, telegram });
  assert.equal(preflight.status, 204);
  assert.equal(telegram.sent.length, 0);
});

test("validation: honeypot, missing consent, unknown fields, bad contact, unknown service", async () => {
  const cases = [
    [{ ...validBody, website: "http://spam.example" }, /не отправлена/],
    [{ ...validBody, consent: false }, /согласие/],
    [{ ...validBody, amount: 100 }, /неизвестные поля/],
    [{ ...validBody, contact: "not-an-email" }, /почту/],
    [{ ...validBody, contactMethod: "telegram", contact: "" }, /Заполните поле «Telegram»/],
    [{ ...validBody, contactMethod: "telegram", contact: "@ab" }, /ник в Telegram/],
    [{ ...validBody, serviceId: "hacking" }, /Услуга/],
    [{ ...validBody, budget: "1000000" }, /Бюджет/],
    [{ ...validBody, task: "" }, /Что нужно сделать/],
  ];
  const telegram = fakeTelegram();
  for (const [body, message] of cases) {
    const response = await createLeadHandler(post(body), { ip: "1.1.1.1", env, telegram, now: NOW });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).error, message);
  }
  assert.equal(telegram.sent.length, 0);
  assert.equal(await (await openStore("leads")).get("index"), null);
});

test("the sixth lead from one IP within an hour gets 429; another IP is not affected", async () => {
  const telegram = fakeTelegram();
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await createLeadHandler(post(validBody), { ip: "198.51.100.1", env, telegram, now: NOW })).status, 201);
  }
  const blocked = await createLeadHandler(post(validBody), { ip: "198.51.100.1", env, telegram, now: NOW });
  assert.equal(blocked.status, 429);
  assert.equal((await createLeadHandler(post(validBody), { ip: "198.51.100.2", env, telegram, now: NOW })).status, 201);
  const nextHour = new Date(NOW.getTime() + 60 * 60 * 1000);
  assert.equal((await createLeadHandler(post(validBody), { ip: "198.51.100.1", env, telegram, now: nextHour })).status, 201);
});

test("if Telegram is down the lead is still saved and the client gets 201", async () => {
  const response = await createLeadHandler(post(validBody), { ip: "1.1.1.1", env, telegram: fakeTelegram({ fail: true }), now: NOW });
  assert.equal(response.status, 201);
  const leads = await openStore("leads");
  const lead = (await leads.get(`lead/${(await leads.get("index")).value[0].id}`)).value;
  assert.equal(lead.notified, false);
});
