// Проверка входных данных. Все функции бросают RequestValidationError с текстом для человека
// и возвращают уже очищенное значение (обрезанные пробелы, приведённые типы).

import { RequestValidationError } from "./http.mjs";

const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_NEWLINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Объект без лишних полей. Возвращает его же. */
export function plainObject(value, allowedKeys, message = "Некорректные данные.") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestValidationError(message);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new RequestValidationError("Форма содержит неизвестные поля.");
  return value;
}

/**
 * Строка: обрезает пробелы, проверяет длину в символах (не в UTF-16) и управляющие символы.
 * multiline — разрешить переводы строк и табуляцию; required=false — пустая строка допустима.
 */
export function text(value, { label, min = 1, max, multiline = false, required = true }) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new RequestValidationError(`Поле «${label}» должно быть текстом.`);
  const normalized = (multiline ? value.replace(/\r\n?/g, "\n") : value).trim();
  if (!normalized && !required) return "";
  const length = [...normalized].length;
  if (length < min) throw new RequestValidationError(`Заполните поле «${label}».`);
  if (length > max) throw new RequestValidationError(`Поле «${label}»: не длиннее ${max} символов.`);
  if ((multiline ? CONTROL_EXCEPT_NEWLINES : CONTROL).test(normalized)) {
    throw new RequestValidationError(`Поле «${label}» содержит недопустимые символы.`);
  }
  return normalized;
}

export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new RequestValidationError(`Выберите значение в поле «${label}».`);
  return value;
}

export function email(value, label = "Почта") {
  const result = text(value, { label, max: 254 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new RequestValidationError("Укажите корректную электронную почту.");
  return result;
}

/** Телефон: цифры, пробелы, скобки, дефисы, «+» в начале; от 7 до 15 цифр. Возвращает как ввели. */
export function phone(value, label = "Телефон") {
  const result = text(value, { label, max: 30 });
  const digits = result.replace(/\D/g, "");
  if (!/^\+?[\d\s()-]+$/.test(result) || digits.length < 7 || digits.length > 15) {
    throw new RequestValidationError("Укажите корректный номер телефона.");
  }
  return result;
}

/** Ник в Telegram: с «@» или без, 5–32 символа латиницы, цифр и «_». Возвращает «@ник». */
export function telegramUsername(value, label = "Telegram") {
  const result = text(value, { label, max: 40 }).replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "");
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(result)) throw new RequestValidationError("Укажите ник в Telegram, например @username.");
  return `@${result}`;
}

/** Ссылка только https://, до 500 символов. */
export function httpsUrl(value, label = "Ссылка") {
  const result = text(value, { label, max: 500 });
  let url;
  try {
    url = new URL(result);
  } catch {
    throw new RequestValidationError(`Поле «${label}»: укажите ссылку целиком, с https://.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new RequestValidationError(`Поле «${label}»: нужна ссылка https://.`);
  }
  return url.href;
}

/** Целое число в пределах. Принимает число или строку из цифр. */
export function integer(value, { label, min, max }) {
  const number = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new RequestValidationError(`Поле «${label}»: целое число от ${min} до ${max}.`);
  }
  return number;
}

/** Сумма в копейках: целое от min до max. Возвращает строку цифр — так она хранится и уходит в ЮKassa. */
export function kopeks(value, { label = "Сумма", min = 100, max = 100_000_000 } = {}) {
  return String(integer(value, { label, min, max }));
}

export function boolean(value, label) {
  if (typeof value !== "boolean") throw new RequestValidationError(`Поле «${label}»: да или нет.`);
  return value;
}

/** Идентификатор (услуги, работы): латиница в нижнем регистре, цифры, «-», 2–32 символа. */
export function slug(value, label = "Идентификатор") {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{1,31}$/.test(value)) {
    throw new RequestValidationError(`Поле «${label}»: латиница, цифры и «-», от 2 до 32 символов.`);
  }
  return value;
}
