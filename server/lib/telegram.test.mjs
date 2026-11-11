import assert from "node:assert/strict";
import test from "node:test";
import { createTelegram, escapeHtml, TelegramError, truncate } from "./telegram.mjs";

const TOKEN = "123456789:AAtest-token-for-unit-tests-only-xxxxx";

test("sendMessage calls the Bot API with HTML parse mode and returns the result", async () => {
  const calls = [];
  const tg = createTelegram(TOKEN, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ ok: true, result: { message_id: 7 } });
    },
  });
  assert.deepEqual(await tg.sendMessage(288440954, "Заявка №1", { reply_markup: { inline_keyboard: [] } }), { message_id: 7 });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_id, 288440954);
  assert.equal(body.parse_mode, "HTML");
  assert.deepEqual(body.reply_markup, { inline_keyboard: [] });
});

test("Telegram errors keep the code and never contain the token", async () => {
  const tg = createTelegram(TOKEN, {
    fetchImpl: async () => Response.json({ ok: false, error_code: 403, description: `Forbidden: bot ${TOKEN} was blocked by the user` }, { status: 403 }),
  });
  await assert.rejects(tg.sendMessage(1, "x"), (error) =>
    error instanceof TelegramError && error.code === 403 && !error.message.includes(TOKEN));

  const offline = createTelegram(TOKEN, { fetchImpl: async () => { throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }); } });
  await assert.rejects(offline.sendMessage(1, "x"), (error) => error.code === "network_error" && !error.message.includes(TOKEN));

  const html = createTelegram(TOKEN, { fetchImpl: async () => new Response("<html>502</html>", { status: 502 }) });
  await assert.rejects(html.getWebhookInfo(), (error) => error.code === 502);
});

test("escapeHtml and truncate", () => {
  assert.equal(escapeHtml(`<b>"Анна" & Co</b>`), `&lt;b&gt;"Анна" &amp; Co&lt;/b&gt;`);
  assert.equal(truncate("абв", 5), "абв");
  assert.equal(truncate("абвгдеж", 5), "абвг…");
  assert.equal([...truncate("😀".repeat(10), 4)].length, 4);
});
