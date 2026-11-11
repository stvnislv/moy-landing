// Услуги и портфолио. Пока (до этапа 5) — значения по умолчанию, те же, что в index.html (site) и tg-app/data.js.
// На этапе 5 они будут читаться из хранилища, а эти значения останутся запасными.

export const DEFAULT_SERVICES = [
  {
    id: "sites",
    title: "Сайты и лендинги",
    description: "Лендинг под услугу, сайт-визитка или доработка старого сайта. Адаптивно для телефона.",
    priceFrom: 25000,
    term: "от 5 дней",
    message: "Здравствуйте! Хочу обсудить сайт или лендинг.",
    visible: true,
  },
  {
    id: "apps",
    title: "Приложения и боты",
    description: "Telegram-боты, веб-приложения, личные кабинеты, калькуляторы и записи онлайн.",
    priceFrom: 20000,
    term: "от 5 дней",
    message: "Здравствуйте! Хочу обсудить приложение или бота.",
    visible: true,
  },
  {
    id: "ai",
    title: "ИИ‑агенты",
    description: "Помощник, который отвечает клиентам, разбирает заявки, готовит документы и экономит часы рутины.",
    priceFrom: 40000,
    term: "от 7 дней",
    message: "Здравствуйте! Хочу обсудить ИИ‑агента.",
    visible: true,
  },
];

export const OTHER_SERVICE = { id: "other", title: "Другое" };

/** Услуги, которые можно выбрать в заявке. */
export async function getServices() {
  return DEFAULT_SERVICES;
}

export function serviceTitle(services, id) {
  if (id === OTHER_SERVICE.id) return OTHER_SERVICE.title;
  return services.find((service) => service.id === id)?.title ?? id;
}
