// Заявки: проверка формы, создание, уведомление владельцу в Telegram.
//
// Раздел хранилища «leads»:
//   lead/<id>        — заявка целиком (поля — BACKEND-PLAN.md, раздел 3.1)
//   index            — краткие строки для списка в админке, новые сверху
//   link/<token>     — { leadId }: ссылка t.me/<бот>?start=l_<token> привязывает чат клиента к заявке
//   tg-msg/<id>      — { leadId }: на какое сообщение в чате владельца можно ответить по заявке
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

const FIELDS = ["serviceId", "task", "budget", "deadline", "name", "contactMethod", "contact", "consent", "website"];

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

  return { serviceId, task, budget, deadline, contact: { name, method, value: contact } };
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
export async function createLead(input, { source, telegramUser = null, now = new Date(), env = process.env }) {
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
    canMessage: Boolean(telegramUser?.allowsWriteToPm),
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
  const reach = lead.canMessage ? "можно ответить через бота" : "бот пока не может написать клиенту";

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
