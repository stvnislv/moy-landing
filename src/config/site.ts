// Все тексты, контакты и цены сайта. Меняйте их здесь, вёрстку трогать не нужно.

export type Service = {
  title: string;
  description: string;
  /** Цена «от», в рублях. */
  priceFrom: number;
};

export type PortfolioItem = {
  title: string;
  description: string;
  /** Ссылка на готовый сайт. */
  url?: string;
  /** Картинка из папки public, например "/works/landing.jpg". */
  image?: string;
};

export const site = {
  name: "Имя Фамилия",
  /** Буквы в круге вместо фото и в иконке сайта. */
  initials: "ИФ",
  role: "сайты и лендинги с помощью ИИ",
  /** Username в Telegram без @. */
  telegram: "your_username",
  /** Адрес сайта после публикации, нужен для превью ссылки. */
  url: "https://example.com",

  description:
    "Делаю сайты и лендинги с помощью ИИ: быстро, современно, по понятной цене.",

  hero: {
    subtitle:
      "Современный сайт за несколько дней, а не недель. Цена известна заранее.",
  },

  about: {
    /** Фото из папки public, например "/photo.jpg". Пока фото нет, показываются инициалы. */
    photo: undefined as string | undefined,
    paragraphs: [
      "Делаю сайты и лендинги для экспертов, мастеров и небольших компаний.",
      "Работаю с помощью ИИ: он берёт на себя рутину, а я отвечаю за смысл, дизайн и результат. Поэтому выходит быстрее и дешевле, чем в студии.",
      "Этот сайт — тоже моя работа. По нему можно судить о качестве.",
    ],
  },

  services: [
    {
      title: "Лендинг",
      description: "Одна страница, которая рассказывает о вашей услуге и приводит заявки.",
      priceFrom: 15000,
    },
    {
      title: "Сайт-визитка",
      description: "Короткий сайт о вас и ваших услугах. Как этот.",
      priceFrom: 10000,
    },
    {
      title: "Доработка или редизайн",
      description: "Обновлю внешний вид вашего сайта или исправлю то, что мешает клиентам.",
      priceFrom: 5000,
    },
  ] satisfies Service[],

  /** Раздел «Работы». Поставьте true, когда добавите проекты в portfolio. */
  showPortfolio: false,
  portfolio: [] as PortfolioItem[],

  contacts: {
    title: "Обсудим ваш сайт?",
    text: "Напишите в Telegram, что нужно сделать. Отвечу и назову точную цену.",
    note: "Отвечаю в течение дня",
  },
};

export const telegramUrl = `https://t.me/${site.telegram}`;

/** Не даёт коротким словам («с», «и», «в») повиснуть в конце строки. */
export function nbsp(text: string) {
  return text.replace(/(?<=^|\s)([а-яёa-z]{1,2}) /gi, "$1 ");
}

export function formatPrice(rubles: number) {
  return `от ${rubles.toLocaleString("ru-RU")} ₽`;
}
