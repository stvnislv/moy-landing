# Project Guidance

Лендинг-портфолио цифрового мастера Stvnislv. Сервера и базы данных нет.

- **Главный документ — `brief.md`.** Если он расходится с другими файлами, прав он. Открытые вопросы владельцу перечислены в его разделе 9: всё нерешённое остаётся заглушкой (в коде помечено `ЗАГЛУШКА`).
- Основа брифа: `research.md` и старая спецификация `thoughts/shared/specs/2026-10-26-sayt-vizitka.md`.

## index.html — основная версия

- Один файл: стили, скрипт и шрифт Geist (`font-family: "Geist Site"`, base64 в `@font-face` в начале `<style>`) внутри. Открывается двойным щелчком.
- Все тексты, цены, контакты и работы лежат в объекте `site` в начале `<script>`. Разметку разделов заполняет скрипт.
- Темы день и ночь: класс `night` на `<html>`, выбор хранится в `localStorage` (`theme`).
- Фон первого экрана — `hero-bg.jpg` рядом с `index.html`. Положение щели на картинке задано в `SLIT` в скрипте, свет пересчитывается под размер окна.
- Портрет в «Обо мне» рисуется на `<canvas>` из данных `PORTRAIT`, встроенных в файл (сделаны из `portrait-cut.png`). `portrait.jpg` больше не используется.
- Проверка: открыть файл в Chrome; режим без анимаций проверять с флагом Chrome `--force-prefers-reduced-motion`. Сборки и тестов нет.

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

Тестов и линтера нет.

## Working in this repository

- Follow the conventions and architecture already present in the repository.
- Keep changes focused on the requested task and preserve unrelated user changes.
- Before making changes, inspect the relevant files and any nearby tests or documentation.
- Run the most relevant available checks after making changes. If no checks are configured, say so.
- Update this file with verified project-specific commands and conventions as the repository takes shape.
