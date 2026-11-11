// Заявки: проверка формы, создание, уведомление владельцу в Telegram.
//
// Раздел хранилища «leads»:
//   lead/<id>        — заявка целиком (поля — BACKEND-PLAN.md, раздел 3.1)
//   index            — краткие строки для списка в админке, новые сверху
//   link/<token>     — { leadId }: ссылка t.me/<бот>?start=l_<token> привязывает чат клиента к заявке
//   tg-msg/<id>      — { leadId }: на какое сообщение в чате владельца можно ответить по заявке
//   tg-chat/<chatId> — { leadId }: последняя заявка клиента с этим чатом — туда попадают его сообщения боту
// Раздел «meta»: lead-counter — номер последней заявки.

import { randomBytes, randomUUID } from "node:crypto";
import { RequestValidationError } from "./http.mjs";
import { openStore, updateJSON } from "./store.mjs";
import { escapeHtml } from "./telegram.mjs";
import * as v from "./validate.mjs";
import { OTHER_SERVICE, serviceTitle } from "./content.mjs";

export const STATUSES = { new: "Новая", in_progress: "В работе", done: "Готово" };
export const BUDGETS = {
  lt30: "до 30 000 ₽",
  "30_60": "30–60 тыс. ₽",
  "60_100": "60–100 тыс. ₽",
  gt100: "больше 100 тыс. ₽",
  unknown: "пока не знаю",
};
export const DEADLINES = {
  asap: "срочно",
  "2w": "в течение 2 недель",
  month: "в течение месяца",
  flexible: "не важно",
};
export const CONTACT_METHODS = { telegram: "Telegram", email: "Почта", phone: "Телефон" };
export const SOURCES = { site: "сайт", miniapp: "Mini App" };
// Версия текста политики (privacy.html). Меняется вместе с текстом — так видно, с какой версией согласился клиент.
export const POLICY_VERSION = "2026-11-11";

const FIELDS = ["serviceId", "task", "budget", "deadline", "name", "contactMethod", "contact", "consent", "website", "writeAccess"];

/** Проверить форму заявки. telegramUser — проверенный пользователь Mini App или null. */
export function validateLeadInput(body, { services, telegramUser = null }) {
  v.plainObject(body, FIELDS, "Проверьте поля заявки.");
  // Ловушка для ботов: поле скрыто от людей, заполняют его только программы.
  if (body.website !== undefined && body.website !== "") throw new RequestValidationError("Заявка не отправлена.");

  const serviceId = v.oneOf(body.serviceId, [...services.map((service) => service.id), OTHER_SERVICE.id], "Услуга");
  const task = v.text(body.task, { label: "Что нужно сделать", min: 3, max: 2000, multiline: true });
  const budget = v.oneOf(body.budget, Object.keys(BUDGETS), "Бюджет");
  const deadline = v.oneOf(body.deadline, Object.keys(DEADLINES), "Сроки");
  const name = v.text(body.name, { label: "Имя", max: 100 });
  const method = v.oneOf(body.contactMethod, Object.keys(CONTACT_METHODS), "Способ связи");

  let contact;
  if (method === "email") contact = v.email(body.contact);
  else if (method === "phone") contact = v.phone(body.contact);
  else if (telegramUser && (body.contact === undefined || body.contact === "")) {
    // Из Mini App ответить можно и без ника — по Telegram ID.
    contact = telegramUser.username ? `@${telegramUser.username}` : "";
  } else contact = v.telegramUsername(body.contact);

  if (body.consent !== true) throw new RequestValidationError("Нужно согласие на обработку персональных данных.");
  // Mini App: клиент только что разрешил боту писать ему (requestWriteAccess). В initData этого ещё нет —
  // он подписан при открытии приложения. Если это неправда, бот получит отказ Telegram и пометит заявку.
  const writeAccess = Boolean(telegramUser) && body.writeAccess === true;

  return { serviceId, task, budget, deadline, contact: { name, method, value: contact }, writeAccess };
}

function summary(lead) {
  return {
    id: lead.id,
    number: lead.number,
    status: lead.status,
    createdAt: lead.createdAt,
    name: lead.contact.name,
    serviceId: lead.serviceId,
    paymentStatus: lead.payment?.status ?? null,
    unread: lead.unread,
  };
}

/** Обновить строку заявки в индексе (или добавить её наверх). */
export async function syncIndex(store, lead) {
  await updateJSON(store, "index", (list) => {
    const rows = (list ?? []).filter((row) => row.id !== lead.id);
    rows.push(summary(lead));
    return rows.sort((a, b) => b.number - a.number);
  });
}

/** Создать заявку. Возвращает её целиком. */
export async function createLead({ writeAccess = false, ...input }, { source, telegramUser = null, now = new Date(), env = process.env }) {
  const leads = await openStore("leads", env);
  const meta = await openStore("meta", env);
  const { value: number } = await updateJSON(meta, "lead-counter", (n) => (n ?? 0) + 1);

  const at = now.toISOString();
  const lead = {
    id: randomUUID(),
    number,
    source,
    createdAt: at,
    updatedAt: at,
    status: "new",
    ...input,
    tg: telegramUser
      ? { userId: telegramUser.id, chatId: telegramUser.id, username: telegramUser.username, firstName: telegramUser.firstName }
      : null,
    canMessage: Boolean(telegramUser?.allowsWriteToPm) || writeAccess,
    linkToken: randomBytes(16).toString("base64url"),
    consent: { at, policyVersion: POLICY_VERSION },
    ownerMessageId: null,
    notified: false,
    note: "",
    messages: [],
    payment: null,
    doneAt: null,
    unread: true,
  };

  if (!(await leads.set(`lead/${lead.id}`, lead, { onlyIfNew: true })).ok) throw new Error("Не удалось сохранить заявку.");
  await leads.set(`link/${lead.linkToken}`, { leadId: lead.id }, { onlyIfNew: true });
  // Клиент из Mini App: его чат известен сразу — сообщения боту будут попадать в эту заявку.
  if (lead.tg) await leads.set(`tg-chat/${lead.tg.chatId}`, { leadId: lead.id });
  await syncIndex(leads, lead);
  return lead;
}

/** Текст уведомления владельцу. Всё, что ввёл клиент, экранируется. */
export function formatLeadForOwner(lead, services) {
  const contact = lead.contact;
  const contactLine = [
    escapeHtml(contact.name),
    contact.value ? `${CONTACT_METHODS[contact.method]}: ${escapeHtml(contact.value)}` : CONTACT_METHODS[contact.method],
    lead.tg && !(contact.method === "telegram" && contact.value) ? `Telegram ID ${lead.tg.userId}` : "",
  ].filter(Boolean).join(" · ");
  const reach = lead.canMessage
    ? "Ответить клиенту: «Ответить» на это сообщение — ответ уйдёт через бота"
    : "Бот пока не может написать клиенту — свяжитесь по контакту";

  return [
    `${lead.status === "new" ? "🆕" : lead.status === "in_progress" ? "🛠" : "✅"} <b>Заявка №${lead.number}</b> · ${SOURCES[lead.source]}`,
    `<b>Услуга:</b> ${escapeHtml(serviceTitle(services, lead.serviceId))}`,
    `<b>Бюджет:</b> ${BUDGETS[lead.budget]} · <b>Сроки:</b> ${DEADLINES[lead.deadline]}`,
    "",
    `<b>Задача:</b>\n${escapeHtml(lead.task)}`,
    "",
    `<b>Контакт:</b> ${contactLine}`,
    `<i>${reach}</i>`,
    `<b>Статус:</b> ${STATUSES[lead.status]}`,
  ].join("\n");
}

/** Кнопки смены статуса под уведомлением: все статусы, кроме текущего. */
export function statusKeyboard(lead) {
  const buttons = Object.entries(STATUSES)
    .filter(([status]) => status !== lead.status)
    .map(([status, label]) => ({ text: label, callback_data: `st:${lead.id}:${status}` }));
  return { inline_keyboard: [buttons] };
}

/**
 * Отправить уведомление владельцу. Ошибка Telegram не теряет заявку: она уже сохранена,
 * notified остаётся false, и уборка (этап 7) повторит отправку. Возвращает true, если ушло.
 */
export async function notifyOwner(lead, { telegram, ownerId, services, env = process.env }) {
  const leads = await openStore("leads", env);
  let message;
  try {
    message = await telegram.sendMessage(ownerId, formatLeadForOwner(lead, services), { reply_markup: statusKeyboard(lead) });
  } catch (error) {
    console.error("Не удалось отправить уведомление о заявке:", { number: lead.number, code: error?.code ?? "unknown" });
    return false;
  }
  await leads.set(`tg-msg/${message.message_id}`, { leadId: lead.id });
  await updateJSON(leads, `lead/${lead.id}`, (current) =>
    current ? { ...current, ownerMessageId: message.message_id, notified: true } : undefined);
  return true;
}

/** Найти заявку по id. */
export async function getLead(id, env = process.env) {
  const leads = await openStore("leads", env);
  return (await leads.get(`lead/${id}`))?.value ?? null;
}

/** Сменить статус заявки. Возвращает обновлённую заявку или null, если её нет. */
export async function setLeadStatus(id, status, { now = new Date(), env = process.env } = {}) {
  if (!Object.hasOwn(STATUSES, status)) throw new RequestValidationError("Неизвестный статус.");
  const leads = await openStore("leads", env);
  const { value: lead } = await updateJSON(leads, `lead/${id}`, (current) => {
    if (!current) return undefined;
    if (current.status === status) return undefined;   // уже такой — ничего не меняем
    return {
      ...current,
      status,
      updatedAt: now.toISOString(),
      doneAt: status === "done" ? current.doneAt ?? now.toISOString() : null,
    };
  });
  if (lead) await syncIndex(leads, lead);
  return lead;
}

/**
 * Клиент с сайта нажал «Получить ответ в Telegram» (/start l_<token>): привязать его чат к заявке,
 * чтобы владелец мог отвечать через бота. Возвращает заявку или null, если ссылка неверная.
 */
export async function linkChatToLead(token, from, chatId, { now = new Date(), env = process.env } = {}) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  const leads = await openStore("leads", env);
  const link = (await leads.get(`link/${token}`))?.value;
  if (!link) return null;
  const { value: lead } = await updateJSON(leads, `lead/${link.leadId}`, (current) => current && {
    ...current,
    tg: {
      userId: from.id,
      chatId,
      username: typeof from.username === "string" ? from.username : "",
      firstName: typeof from.first_name === "string" ? from.first_name : "",
    },
    canMessage: true,
    updatedAt: now.toISOString(),
  });
  if (!lead) return null;
  await leads.set(`tg-chat/${chatId}`, { leadId: lead.id });
  return lead;
}

// ---------- Переписка через бота ----------
const MESSAGES_KEEP = 200;
const MESSAGE_TEXT_MAX = 1000;

/** Запомнить, что сообщение в чате владельца относится к заявке: на него можно ответить. */
export async function mapOwnerMessage(messageId, leadId, env = process.env) {
  await (await openStore("leads", env)).set(`tg-msg/${messageId}`, { leadId });
}

/** Заявка, к которой относится сообщение в чате владельца (уведомление или сообщение клиента). */
export async function findLeadByOwnerMessage(messageId, env = process.env) {
  const leads = await openStore("leads", env);
  const link = (await leads.get(`tg-msg/${messageId}`))?.value;
  return link ? (await leads.get(`lead/${link.leadId}`))?.value ?? null : null;
}

/** Последняя заявка клиента, который пишет боту из этого чата. */
export async function findLeadByChat(chatId, env = process.env) {
  const leads = await openStore("leads", env);
  const link = (await leads.get(`tg-chat/${chatId}`))?.value;
  return link ? (await leads.get(`lead/${link.leadId}`))?.value ?? null : null;
}

/** Короткий текст сообщения для истории: текст, подпись к вложению или «[вложение]». */
export function messageSummary(message) {
  const text = message.text ?? message.caption ?? "";
  const kind = message.photo ? "фото" : message.document ? "файл" : message.voice ? "голосовое" : message.video ? "видео" : message.sticker ? "стикер" : "вложение";
  const summary = message.text ? text : `[${kind}]${text ? ` ${text}` : ""}`;
  return [...summary].slice(0, MESSAGE_TEXT_MAX).join("");
}

/**
 * Добавить сообщение в историю заявки. from — "owner" или "client".
 * Сообщение клиента помечает заявку непрочитанной; раз клиент сам написал боту, бот может ему отвечать.
 */
export async function addLeadMessage(leadId, from, text, { now = new Date(), env = process.env } = {}) {
  const leads = await openStore("leads", env);
  const { value: lead } = await updateJSON(leads, `lead/${leadId}`, (current) => current && {
    ...current,
    messages: [...(current.messages ?? []), { from, text, at: now.toISOString() }].slice(-MESSAGES_KEEP),
    unread: from === "client" ? true : current.unread,
    canMessage: from === "client" ? true : current.canMessage,
    updatedAt: now.toISOString(),
  });
  if (lead) await syncIndex(leads, lead);
  return lead;
}

/** Telegram ответил «нельзя писать этому клиенту» (заблокировал бота) — больше не пытаться. */
export async function markUnreachable(leadId, { env = process.env } = {}) {
  const leads = await openStore("leads", env);
  await updateJSON(leads, `lead/${leadId}`, (current) => (current && current.canMessage ? { ...current, canMessage: false } : undefined));
}

/** Контакт клиента одной строкой — чтобы владелец мог связаться сам. */
export function contactLine(lead) {
  const { name, method, value } = lead.contact;
  return value ? `${name}, ${CONTACT_METHODS[method]}: ${value}` : name;
}
