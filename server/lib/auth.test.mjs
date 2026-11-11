import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthError,
  getOwnerId,
  isTelegramWebhook,
  requireOwner,
  signInitData,
  telegramUserFromRequest,
  verifyInitData,
} from "./auth.mjs";

const TOKEN = "123456789:AAtest-token-for-unit-tests-only-xxxxx";
const OTHER_TOKEN = "987654321:AAanother-token-for-unit-tests-yyyyy";
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
const authDate = String(Math.floor(NOW / 1000) - 60);
const env = { TELEGRAM_BOT_TOKEN: TOKEN, OWNER_TELEGRAM_ID: "288440954", TELEGRAM_WEBHOOK_SECRET: "s".repeat(40) };

function initDataFor(userId, overrides = {}) {
  return signInitData({
    auth_date: authDate,
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: userId, first_name: "Анна", username: "anna_test", allows_write_to_pm: true }),
    ...overrides,
  }, TOKEN);
}

const request = (headers) => new Request("https://example.com/api/admin/me", { headers });

test("valid initData returns the verified user", () => {
  const session = verifyInitData(initDataFor(42, { start_param: "services" }), TOKEN, { now: NOW });
  assert.deepEqual(session.user, { id: 42, firstName: "Анна", lastName: "", username: "anna_test", allowsWriteToPm: true });
  assert.equal(session.startParam, "services");
});

test("initData with a wrong signature, changed field, or other bot token is rejected", () => {
  const valid = initDataFor(42);
  const tampered = valid.replace("%22id%22%3A42", "%22id%22%3A288440954");
  assert.notEqual(tampered, valid);
  assert.throws(() => verifyInitData(tampered, TOKEN, { now: NOW }), AuthError);
  assert.throws(() => verifyInitData(valid, OTHER_TOKEN, { now: NOW }), AuthError);
  assert.throws(() => verifyInitData(valid.replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64)), TOKEN, { now: NOW }), AuthError);
  assert.throws(() => verifyInitData(`${valid}&hash=${"0".repeat(64)}`, TOKEN, { now: NOW }), AuthError);
  assert.throws(() => verifyInitData("", TOKEN, { now: NOW }), AuthError);
  assert.throws(() => verifyInitData("x".repeat(5000), TOKEN, { now: NOW }), AuthError);
});

test("initData older than 24 hours or from the future is rejected", () => {
  const old = signInitData({ auth_date: String(Math.floor(NOW / 1000) - 86401), user: JSON.stringify({ id: 42 }) }, TOKEN);
  const future = signInitData({ auth_date: String(Math.floor(NOW / 1000) + 3600), user: JSON.stringify({ id: 42 }) }, TOKEN);
  assert.throws(() => verifyInitData(old, TOKEN, { now: NOW }), /устарела/);
  assert.throws(() => verifyInitData(future, TOKEN, { now: NOW }), AuthError);
});

test("initData without a user is rejected", () => {
  const noUser = signInitData({ auth_date: authDate }, TOKEN);
  const badUser = signInitData({ auth_date: authDate, user: "{not json" }, TOKEN);
  assert.throws(() => verifyInitData(noUser, TOKEN, { now: NOW }), /нет пользователя/);
  assert.throws(() => verifyInitData(badUser, TOKEN, { now: NOW }), /нет пользователя/);
});

test("requireOwner: 401 without auth, 403 for another user, passes for the owner", () => {
  const options = { now: NOW };
  assert.throws(() => requireOwner(request({}), env, options), (e) => e instanceof AuthError && e.status === 401);
  assert.throws(() => requireOwner(request({ Authorization: "Bearer x" }), env, options), (e) => e.status === 401);
  assert.throws(() => requireOwner(request({ Authorization: `tma ${initDataFor(42)}` }), env, options), (e) => e.status === 403);
  assert.equal(requireOwner(request({ Authorization: `tma ${initDataFor(288440954)}` }), env, options).user.id, 288440954);
});

test("telegramUserFromRequest returns null for anonymous requests", () => {
  assert.equal(telegramUserFromRequest(request({}), env, { now: NOW }), null);
});

test("owner id and webhook secret are validated", () => {
  assert.equal(getOwnerId(env), 288440954);
  assert.throws(() => getOwnerId({ OWNER_TELEGRAM_ID: "abc" }));
  assert.equal(isTelegramWebhook(request({ "X-Telegram-Bot-Api-Secret-Token": "s".repeat(40) }), env), true);
  assert.equal(isTelegramWebhook(request({ "X-Telegram-Bot-Api-Secret-Token": "s".repeat(39) }), env), false);
  assert.equal(isTelegramWebhook(request({}), env), false);
  assert.throws(() => isTelegramWebhook(request({}), { TELEGRAM_WEBHOOK_SECRET: "short" }));
});
