# Project Guidance

Лендинг-портфолио цифрового мастера Stvnislv. Страница статическая; для тестовой оплаты используются Netlify Functions и Netlify Blobs.

- **Главный документ — `brief.md`.** Если он расходится с другими файлами, прав он. Открытые вопросы владельцу перечислены в его разделе 9: всё нерешённое остаётся заглушкой (в коде помечено `ЗАГЛУШКА`).
- Основа брифа: `research.md` и старая спецификация `thoughts/shared/specs/2026-10-26-sayt-vizitka.md`.

## index.html — основная версия

- Один файл: стили, скрипт и шрифт Geist (`font-family: "Geist Site"`, base64 в `@font-face` в начале `<style>`) внутри. Открывается двойным щелчком.
- Все тексты, цены, контакты и работы лежат в объекте `site` в начале `<script>`. Разметку разделов заполняет скрипт.
- Темы день и ночь: класс `night` на `<html>`, выбор хранится в `localStorage` (`theme`).
- Фон первого экрана — `hero-bg.jpg` рядом с `index.html`. Положение щели на картинке задано в `SLIT` в скрипте, свет пересчитывается под размер окна.
- Портрет в «Обо мне» рисуется на `<canvas>` из данных `PORTRAIT`, встроенных в файл (сделаны из `portrait-cut.png`). `portrait.jpg` больше не используется.
- Проверка интерфейса: открыть файл в Chrome; режим без анимаций проверять с флагом Chrome `--force-prefers-reduced-motion`. Платёжные функции в таком режиме не работают.
- Оплата доступна только на опубликованном Netlify-сайте, не при открытии файла локально. Функции находятся в `netlify/functions/`; сумма и услуга задаются серверными переменными `YOOKASSA_AMOUNT_KOPEKS` и `YOOKASSA_ITEM_NAME`, платёжная форма проверяется на сервере. Использовать только тестовые реквизиты ЮKassa и `YOOKASSA_MODE=test`.
- Статус оплаты меняется только в обработчике webhook после сверки платежа через API ЮKassa; возврат браузера на сайт не считается подтверждением. Статус хранится в Netlify Blobs. Настроить в кабинете ЮKassa webhook URL `/.netlify/functions/yookassa-webhook` и события `payment.succeeded`, `payment.canceled`, `payment.waiting_for_capture`.
- Не публиковать реальные ключи и не использовать стартовые цены из сайта как сумму оплаты. Перед реальным режимом настроить фискализацию в кабинете ЮKassa.

## Бэкенд заявок — в работе

План и этапы — `BACKEND-PLAN.md`. Решение владельца 11.11.2026: **данные в Supabase** (одна таблица `kv`, `supabase/schema.sql`), **функции — Netlify** (`netlify/functions/`). VPS не арендован; на возможный переезд в Россию в коде оставлены драйвер `file` и сервер `server/server.mjs`.

- Логика — в `server/`: `handlers/` — обработчики `(Request, { ip, env }) → Response`; `lib/` — `http` (ответы, CORS), `store` — **всё хранилище только через него** (драйверы `supabase` — основной, `file`, `blobs`, `memory` — тесты), `auth` (Telegram initData, владелец — `OWNER_TELEGRAM_ID`), `validate`, `telegram` (Bot API), `leads`, `ratelimit`, `content`.
- `netlify/functions/<имя>.mjs` — тонкая обёртка над обработчиком с `export const config = { path: "/api/…" }`.
- Supabase: проект `isbwhkbliietwvgpofip` (East US, Ohio). Только секретный ключ на сервере (`SUPABASE_SECRET_KEY`), без `@supabase/supabase-js` — REST через `fetch`. Публичный ключ не используется, в браузер Supabase не подключается.
- Сделано: этап 1 и сервер этапа 2 (`POST /api/leads`). Формы на сайте и в Mini App — следующий шаг.
- Проверка на Mac: в `.env` задать `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ALLOWED_ORIGINS=http://localhost:3000`, `IP_HASH_SALT`, `STATIC_ROOT=.`; затем `npm run server` и открыть http://localhost:3000/. Заявка запишется в Supabase и придёт владельцу в Telegram по-настоящему.

## tg-app/ — Telegram Mini App

Мини-приложение по разделу 11 брифа: HTML, CSS и JS без сборки, точка входа `tg-app/index.html`. Устройство, навигация и где менять данные — в `tg-app/CLAUDE.md`. Тексты и цены лежат отдельно от сайта, в `tg-app/data.js`. Опубликовано отдельным сайтом Netlify: https://stvnislv-app.netlify.app/ (выкладывается вручную через Netlify CLI, не через push; как — в `tg-app/CLAUDE.md`). Основной сайт после push тоже копирует папку в `/tg-app/`.

## Next.js-версия (`src/`, `package.json`) — устарела

Осталась от первой спецификации и не обновлялась по `brief.md`. Удалить её или держать как архив — открытый вопрос 5 брифа; до ответа не трогать.

## Git

- Репозиторий: https://github.com/stvnislv/moy-landing, ветка `main`, remote `origin` (SSH, ключ `~/.ssh/id_ed25519`).
- Сайт опубликован на Netlify: https://stvnislv.netlify.app/. Каждый push в `main` — новая публикация, она тратит 15 из 300 бесплатных кредитов в месяц. Когда кредиты кончаются, сайт отключается до следующего месяца.
- Поэтому после изменения — только коммит с коротким описанием по-русски, **без push**. Правки проверяются в `index.html` на Mac.
- `git push origin main` — только когда владелец скажет «публикуй» (или «опубликуй», «отправь на сайт»). Перед push сказать, сколько коммитов уйдёт.
- Если push нужен без публикации (например, правка только этого файла или брифа), добавить в сообщение коммита `[skip netlify]`.
- Без force-push.

## Commands

Node.js стоит в `~/.local/node`, а не в системе. Перед командами: `export PATH=~/.local/node/bin:$PATH`.

- `npm run dev`: сервер разработки на http://localhost:3000
- `npm run build`: production-сборка, включая проверку типов
- `npm run typecheck`: только проверка типов
- `npm test`: все тесты (`server/` и `netlify/functions/`), без сети
- `npm run server`: API-сервер заявок с настройками из `.env` (см. раздел «Бэкенд заявок»)
- `node scripts/setup-telegram-bot.mjs`: описание, короткое описание и команды бота @stvnislv_bot через Bot API (нужен `TELEGRAM_BOT_TOKEN` в `.env`; `--check` — только показать текущие). Токен не выводит.
- `node bot/bot.mjs`: бот @stvnislv_bot на Маке (long polling, без сервера): отвечает на /start, /help, /contact; кнопка открывает Mini App по `APP_URL` в начале файла. Остановка — Ctrl+C. Работает, только пока открыт Терминал и Мак не спит. Без внешних библиотек.

Линтера нет. Платёжные функции локально требуют Netlify Dev и тестовых переменных окружения.

## Working in this repository

- Follow the conventions and architecture already present in the repository.
- Keep changes focused on the requested task and preserve unrelated user changes.
- Before making changes, inspect the relevant files and any nearby tests or documentation.
- Run the most relevant available checks after making changes. If no checks are configured, say so.
- Update this file with verified project-specific commands and conventions as the repository takes shape.
