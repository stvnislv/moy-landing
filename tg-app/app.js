// Логика мини-приложения:
// 1) связь с Telegram: имя пользователя, тема, кнопка «Назад», вибрация, ссылки;
// 2) заполнение экранов данными из data.js;
// 3) переходы между экранами по нижнему меню.
// Вне Telegram (обычный браузер) всё работает так же, только без SDK.

(() => {
  const data = window.APP_DATA;
  const tg = window.Telegram && window.Telegram.WebApp;
  // initData непустой, только когда приложение открыто внутри Telegram.
  const inTelegram = Boolean(tg && tg.initData);
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (selector) => document.querySelector(selector);

  // ============================================================
  // Telegram: тема и системные кнопки
  // ============================================================
  const supports = (version) => inTelegram && tg.isVersionAtLeast(version);

  // Тема как на сайте: день — тёплый светло-серый, ночь — тёмный титан.
  // Какую включить, решает Telegram (его светлая или тёмная тема).
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    const night = inTelegram ? tg.colorScheme === "dark" : darkQuery.matches;
    document.documentElement.classList.toggle("night", night);
    const bg = night ? "#1c1b1a" : "#f3f3f1";
    document.querySelector('meta[name="theme-color"]').content = bg;
    // Шапка и низ окна Telegram — в цвет фона, чтобы не было рамки вокруг приложения.
    if (supports("6.9")) { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); }
    if (supports("7.10")) tg.setBottomBarColor(bg);
  }
  applyTheme();
  if (inTelegram) tg.onEvent("themeChanged", applyTheme);
  else darkQuery.addEventListener("change", applyTheme);

  if (inTelegram) {
    tg.ready();
    tg.expand();                                     // сразу на весь экран, без «половинки»
    if (supports("7.7")) tg.disableVerticalSwipes(); // прокрутка экрана не закрывает приложение
  }

  // Лёгкая вибрация на касание. Вне Telegram — ничего.
  const haptic = {
    tap: () => supports("6.1") && tg.HapticFeedback.impactOccurred("light"),
    select: () => supports("6.1") && tg.HapticFeedback.selectionChanged(),
    success: () => supports("6.1") && tg.HapticFeedback.notificationOccurred("success"),
  };

  // Ссылки: Telegram-чаты открываются внутри Telegram, остальное — во встроенном браузере.
  function openTelegram(text) {
    // ?text= подставляет сообщение в поле ввода чата (в старых версиях Telegram просто откроется чат).
    const url = `https://t.me/${data.telegram}` + (text ? `?text=${encodeURIComponent(text)}` : "");
    if (inTelegram) tg.openTelegramLink(url);
    else window.open(url, "_blank", "noopener");
  }
  function openLink(url) {
    if (inTelegram) tg.openLink(url);
    else window.open(url, "_blank", "noopener");
  }

  // Всплывающее сообщение над нижним меню.
  const toast = $(".toast");
  let toastTimer = 0;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-shown"), 2200);
  }

  // Почту из Telegram не открыть ссылкой mailto, поэтому адрес копируется.
  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(data.email);
      haptic.success();
      showToast("Почта скопирована");
    } catch {
      showToast(data.email);
    }
  }

  // ============================================================
  // Заполнение экранов
  // ============================================================
  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // Не даёт коротким словам («с», «и», «в») повиснуть в конце строки.
  const nbsp = (text) => esc(text).replace(/(?<=^|\s)([а-яёa-z]{1,2}) /gi, "$1 ");
  const price = (rubles) => `от ${rubles.toLocaleString("ru-RU")} ₽`;

  const icons = {
    telegram: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.9 4.3c.3-1.3-.5-1.8-1.4-1.5L2.8 9.6c-1.2.5-1.2 1.2-.2 1.5l4.5 1.4 1.7 5.3c.2.6.4.8.8.8.4 0 .6-.2.9-.4l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14.4ZM8 12.2l9.9-6.2c.5-.3.9-.1.5.2l-8.2 7.4-.3 3.4L8 12.2Z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5"/><path d="M19 5 10 14"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/></svg>',
    chevron: '<svg class="row-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  };

  // Главная: приветствие по имени из Telegram, имя мастера, фраза.
  const user = inTelegram && tg.initDataUnsafe && tg.initDataUnsafe.user;
  $("[data-greeting]").textContent = user && user.first_name ? `Здравствуйте, ${user.first_name}!` : "Здравствуйте!";
  $("[data-name]").textContent = data.name;
  $("[data-role]").textContent = data.home.role;
  $("[data-phrase]").innerHTML = nbsp(data.home.phrase);

  // Услуги: карточка — название, срок, описание, цена «от» и кнопка «Обсудить».
  $("[data-services]").innerHTML = data.services.map((s, i) => `
    <article class="card glass">
      <div class="card-head">
        <h3 class="card-title">${esc(s.title)}</h3>
        <span class="chip">${esc(s.term)}</span>
      </div>
      <p class="card-desc">${nbsp(s.description)}</p>
      <div class="card-foot">
        <p class="price">${price(s.price)}</p>
        <button type="button" class="btn-ghost tap" data-discuss="${i}">Обсудить</button>
      </div>
    </article>`).join("");
  $("[data-services-note]").innerHTML = nbsp(data.servicesNote);

  // Портфолио: работы из data.js и в конце — приглашение.
  const previews = {
    site: '<div class="preview preview-site" aria-hidden="true"></div>',
    app: '<div class="preview preview-app" aria-hidden="true"><div class="mini-phone"></div></div>',
  };
  $("[data-portfolio]").innerHTML = data.portfolio.map((w, i) => `
    <article class="card glass work">
      ${previews[w.preview] || ""}
      <div class="work-body">
        <h3 class="card-title">${esc(w.title)}</h3>
        <p class="card-desc">${nbsp(w.description)}</p>
        <div class="tags">${w.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
        ${w.url ? `<button type="button" class="btn-ghost tap" data-open-work="${i}">${icons.open}Открыть сайт</button>` : ""}
      </div>
    </article>`).join("") + `
    <div class="invite">
      <p>${nbsp(data.portfolioInvite)}</p>
      <button type="button" class="btn-ghost tap" data-discuss-project>${icons.telegram}Обсудить</button>
    </div>`;

  // Связаться: панель с главной кнопкой, список контактов, шаги работы.
  $("[data-contact-title]").textContent = data.contacts.title;
  $("[data-contact-text]").innerHTML = nbsp(data.contacts.text);
  $("[data-telegram-button]").innerHTML = `${icons.telegram}<span>${esc(data.contacts.button)}</span>`;
  const rows = [
    { action: "telegram", icon: icons.telegram, title: "Telegram", sub: `@${data.telegram}` },
    { action: "instagram", icon: icons.instagram, title: "Instagram", sub: `@${data.instagram}` },
    { action: "email", icon: icons.mail, title: "Почта", sub: data.email },
  ];
  $("[data-contact-list]").innerHTML = rows.map((r) => `
    <li><button type="button" class="row tap" data-contact="${r.action}">
      <span class="row-icon">${r.icon}</span>
      <span><span class="row-title">${r.title}</span><span class="row-sub">${esc(r.sub)}</span></span>
      ${icons.chevron}
    </button></li>`).join("");
  $("[data-steps]").innerHTML = data.steps.map((s, i) => `
    <li class="step">
      <span class="step-number">${String(i + 1).padStart(2, "0")}</span>
      <span class="step-title">${esc(s.title)}</span>
      <p class="step-text">${nbsp(s.text)}</p>
    </li>`).join("");
  $("[data-footer]").textContent = `© ${new Date().getFullYear()} ${data.name}`;

  // ============================================================
  // Нажатия
  // ============================================================
  // Один обработчик на всё приложение: смотрит, какая кнопка нажата, по data-атрибуту.
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.tab) return;                 // меню обрабатывается ниже
    haptic.tap();
    if (target.dataset.discuss) openTelegram(data.services[target.dataset.discuss].message);
    else if (target.hasAttribute("data-discuss-project")) openTelegram("Здравствуйте! Хочу обсудить проект.");
    else if (target.dataset.openWork) openLink(data.portfolio[target.dataset.openWork].url);
    else if (target.hasAttribute("data-telegram-button")) openTelegram();
    else if (target.dataset.contact === "telegram") openTelegram();
    else if (target.dataset.contact === "instagram") openLink(`https://instagram.com/${data.instagram}`);
    else if (target.dataset.contact === "email") copyEmail();
  });
  // В Safari на iPhone :active (отклик на касание) работает, только если на странице есть touchstart.
  document.addEventListener("touchstart", () => {}, { passive: true });

  // ============================================================
  // Навигация между экранами
  // ============================================================
  // Порядок экранов = порядок кнопок меню. Переход вправо по меню — экран въезжает справа, и наоборот.
  const order = ["home", "services", "portfolio", "contact"];
  const screens = Object.fromEntries(order.map((name) => [name, $(`[data-screen="${name}"]`)]));
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const tabbar = $(".tabbar");
  let current = "home";
  let running = [];

  function show(name) {
    if (!screens[name]) return;
    if (name === current) {                          // повторное нажатие — наверх экрана
      screens[name].scrollTo({ top: 0, behavior: calm.matches ? "auto" : "smooth" });
      return;
    }
    const from = screens[current];
    const to = screens[name];
    const dir = order.indexOf(name) > order.indexOf(current) ? 1 : -1;

    // Если прошлый переход ещё идёт — обрываем его, лишние экраны прячем.
    running.forEach((a) => a.cancel());
    running = [];
    order.forEach((n) => { if (screens[n] !== from && screens[n] !== to) screens[n].hidden = true; });

    to.hidden = false;
    to.inert = false;
    from.inert = true;                               // уходящий экран не ловит касания, пока гаснет
    to.scrollTop = 0;
    current = name;
    updateMenu();
    if (name === "home" && window.portrait) window.portrait.refresh();   // холст портрета получил размер

    if (calm.matches || !to.animate) { from.hidden = true; return; }
    // Старый экран уходит в сторону и гаснет (200 мс), новый въезжает с другой стороны (260 мс).
    const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
    const out = from.animate(
      [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: `translateX(${-dir * 28}px)` }],
      { duration: 200, easing: "ease-in", fill: "forwards" },
    );
    const enter = to.animate(
      [{ opacity: 0, transform: `translateX(${dir * 36}px)` }, { opacity: 1, transform: "translateX(0)" }],
      { duration: 260, easing: ease },
    );
    // Старый экран прячется по концу анимации; таймер — запасной путь, если браузер
    // приостановил анимацию (например, приложение свернули). Текущий экран не трогаем.
    const hideFrom = () => {
      if (from === screens[current]) return;
      from.hidden = true;
      out.cancel();
    };
    out.onfinish = hideFrom;
    setTimeout(hideFrom, 260);
    running = [out, enter];
  }

  function updateMenu() {
    tabs.forEach((tab) => {
      if (tab.dataset.tab === current) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    tabbar.style.setProperty("--tab-index", order.indexOf(current));
    // Кнопка «Назад» в шапке Telegram видна на всех экранах, кроме «Главной», и ведёт на неё.
    if (supports("6.1")) {
      if (current === "home") tg.BackButton.hide();
      else tg.BackButton.show();
    }
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => {
    if (tab.dataset.tab !== current) haptic.select();
    show(tab.dataset.tab);
  }));
  if (supports("6.1")) tg.BackButton.onClick(() => show("home"));

  // Открыть сразу нужный экран: в Telegram — ссылкой t.me/<бот>/<приложение>?startapp=services,
  // в браузере — адресом tg-app/#services.
  const start = (inTelegram && tg.initDataUnsafe.start_param) || location.hash.slice(1);
  if (start && screens[start] && start !== "home") {
    screens.home.hidden = true;
    screens[start].hidden = false;
    current = start;
  }
  updateMenu();
})();
