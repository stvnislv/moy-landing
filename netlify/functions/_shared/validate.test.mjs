import assert from "node:assert/strict";
import test from "node:test";
import { RequestValidationError } from "./http.mjs";
import { boolean, email, httpsUrl, integer, kopeks, oneOf, phone, plainObject, slug, telegramUsername, text } from "./validate.mjs";

const fails = (fn, pattern) => assert.throws(fn, (e) => e instanceof RequestValidationError && (!pattern || pattern.test(e.message)));

test("plainObject rejects non-objects and unknown fields", () => {
  assert.deepEqual(plainObject({ a: 1 }, ["a", "b"]), { a: 1 });
  fails(() => plainObject(null, ["a"]));
  fails(() => plainObject([], ["a"]));
  fails(() => plainObject({ a: 1, amount: 5 }, ["a"]), /неизвестные поля/);
});

test("text trims, counts characters, and blocks control characters", () => {
  assert.equal(text("  Анна  ", { label: "Имя", max: 100 }), "Анна");
  assert.equal(text("😀".repeat(3), { label: "Имя", max: 3 }), "😀😀😀");
  assert.equal(text("строка 1\r\nстрока 2", { label: "Задача", max: 50, multiline: true }), "строка 1\nстрока 2");
  assert.equal(text("   ", { label: "Заметка", max: 10, required: false }), "");
  assert.equal(text(undefined, { label: "Заметка", max: 10, required: false }), "");
  fails(() => text("   ", { label: "Имя", max: 100 }), /Заполните/);
  fails(() => text("a".repeat(101), { label: "Имя", max: 100 }), /не длиннее 100/);
  fails(() => text("a\nb", { label: "Имя", max: 100 }), /недопустимые/);
  fails(() => text("a\u0000b", { label: "Задача", max: 100, multiline: true }), /недопустимые/);
  fails(() => text(5, { label: "Имя", max: 100 }), /текстом/);
});

test("contacts: email, phone, telegram username", () => {
  assert.equal(email(" anna@example.com "), "anna@example.com");
  fails(() => email("anna@"));
  assert.equal(phone("+7 (999) 123-45-67"), "+7 (999) 123-45-67");
  fails(() => phone("123"));
  fails(() => phone("+7 999 abc"));
  assert.equal(telegramUsername("@anna_test"), "@anna_test");
  assert.equal(telegramUsername("https://t.me/anna_test"), "@anna_test");
  fails(() => telegramUsername("@ann"));
  fails(() => telegramUsername("@анна_тест"));
});

test("httpsUrl accepts only https links without credentials", () => {
  assert.equal(httpsUrl("https://stvnislv.netlify.app"), "https://stvnislv.netlify.app/");
  fails(() => httpsUrl("http://example.com"));
  fails(() => httpsUrl("javascript:alert(1)"));
  fails(() => httpsUrl("https://user:pass@example.com"));
  fails(() => httpsUrl("example.com"));
});

test("numbers, kopeks, enums, booleans, slugs", () => {
  assert.equal(integer("25000", { label: "Цена", min: 0, max: 10_000_000 }), 25000);
  fails(() => integer(1.5, { label: "Цена", min: 0, max: 10 }));
  fails(() => integer("1e3", { label: "Цена", min: 0, max: 10_000 }));
  assert.equal(kopeks(1250000), "1250000");
  fails(() => kopeks(99));
  fails(() => kopeks(100_000_001));
  assert.equal(oneOf("new", ["new", "done"], "Статус"), "new");
  fails(() => oneOf("paid", ["new", "done"], "Статус"));
  assert.equal(boolean(false, "Видно"), false);
  fails(() => boolean("true", "Видно"));
  assert.equal(slug("sites"), "sites");
  fails(() => slug("Sites"));
  fails(() => slug("s"));
});
