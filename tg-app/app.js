// Логика мини-приложения:
// 1) связь с Telegram: имя пользователя, тема, кнопка «Назад», вибрация, ссылки;
// 2) заполнение экранов данными из data.js;
// 3) переходы между экранами по нижнему меню;
// 4) лёгкий режим для слабых телефонов и отклик кнопок (подсветка и мерцание).
// Вне Telegram (обычный браузер) всё работает так же, только без SDK.

(() => {
  const data = window.APP_DATA;
  const tg = window.Telegram && window.Telegram.WebApp;
  // initData непустой, только когда приложение открыто внутри Telegram.
  const inTelegram = Boolean(tg && tg.initData);
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (selector) => document.querySelector(selector);

  // ============================================================
  // Лёгкий режим для слабых телефонов
  // ============================================================
  // Класс lite на <html> выключает самое тяжёлое (см. конец styles.css) и уменьшает число липких нитей.
  // Сразу включается, если: Telegram на Android сам пометил телефон как слабый (LOW в описании устройства),
  // у телефона мало памяти (≤ 2 ГБ) или ядер (≤ 2), включена экономия трафика.
  // Иначе — замер: если первые 1,5 секунды кадры идут реже ~40 в секунду, режим включается тогда.
  const root = document.documentElement;
  const weakDevice =
    /;\s*LOW\)/.test(navigator.userAgent) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) ||
    (navigator.connection && navigator.connection.saveData);
  const liteListeners = [];
  function goLite() {
    if (root.classList.contains("lite")) return;
    root.classList.add("lite");
    liteListeners.forEach((fn) => fn());
  }
  // Для проверки: адрес с ?lite=1 включает лёгкий режим, с ?lite=0 — выключает замер.
  const liteParam = new URLSearchParams(location.search).get("lite");
  if (weakDevice || liteParam === "1") goLite();
  else if (liteParam !== "0") {
    const frames = [];
    let last = 0;
    const sample = (now) => {
      if (last) frames.push(now - last);
      last = now;
      if (frames.length < 90) requestAnimationFrame(sample);
      else {
        frames.sort((x, y) => x - y);
        if (frames[Math.floor(frames.length / 2)] > 25) goLite();   // медиана кадра > 25 мс
      }
    };
    // замер начинается после открытия, когда идёт самая тяжёлая анимация приветствия;
    // в фоне (приложение свернули) кадры не идут — не меряем
    setTimeout(() => { if (!document.hidden) requestAnimationFrame(sample); }, 300);
  }

  // ============================================================
  // Telegram: тема и системные кнопки
  // ============================================================
  const supports = (version) => inTelegram && tg.isVersionAtLeast(version);

  // Тема как на сайте: день — тёплый светло-серый, ночь — тёмный титан.
  // Если человек выбрал тему переключателем, выбор запоминается (localStorage, ключ theme)
  // и важнее всего. Если не выбирал — тема следует за Telegram (вне Telegram — за системой).
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const themeToggle = $(".theme-toggle");
  function savedTheme() {
    try { return localStorage.getItem("theme"); } catch { return null; }   // хранилище может быть недоступно
  }
  function applyTheme() {
    const saved = savedTheme();
    const night = saved ? saved === "night" : inTelegram ? tg.colorScheme === "dark" : darkQuery.matches;
    document.documentElement.classList.toggle("night", night);
    themeToggle.setAttribute("aria-checked", String(night));
    themeToggle.setAttribute("aria-label", night ? "Дневной режим" : "Ночной режим");
    const bg = night ? "#1c1b1a" : "#f3f3f1";
    document.querySelector('meta[name="theme-color"]').content = bg;
    // Шапка и низ окна Telegram — в цвет фона, чтобы не было рамки вокруг приложения.
    if (supports("6.9")) { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); }
    if (supports("7.10")) tg.setBottomBarColor(bg);
  }
  applyTheme();
  if (inTelegram) tg.onEvent("themeChanged", applyTheme);
  else darkQuery.addEventListener("change", applyTheme);
  themeToggle.addEventListener("click", () => {
    const night = !document.documentElement.classList.contains("night");
    try { localStorage.setItem("theme", night ? "night" : "day"); } catch { /* не запомнится — не страшно */ }
    haptic.select();
    applyTheme();
  });

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
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
    // Те же значки, что в нижнем меню.
    services: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/></svg>',
    portfolio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="17" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M3.5 12.5h17"/></svg>',
  };

  // «Поделиться с другом»: ссылка на бота. В Telegram открывается выбор чата (t.me/share/url) —
  // человек выбирает друга, и уходит сообщение со ссылкой и подписью из data.share.text.
  // Вне Telegram — системное «Поделиться» телефона, а если его нет — ссылка копируется.
  const botUrl = `https://t.me/${data.bot}`;
  async function shareBot() {
    const text = data.share.text;
    if (inTelegram) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(botUrl)}&text=${encodeURIComponent(text)}`);
      return;
    }
    if (navigator.share) {
      try { await navigator.share({ title: data.name, text, url: botUrl }); } catch { /* человек передумал */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(botUrl);
      haptic.success();
      showToast(data.share.copied);
    } catch {
      showToast(botUrl);
    }
  }

  // Щель на главной: где на картинке hero-bg.jpg лежит линия (доли ширины и высоты картинки) —
  // те же числа, что SLIT на сайте. Картинка растянута по cover и стоит по центру, поэтому
  // положение линии пересчитывается под размер сцены, и свет всегда точно под щелью.
  const SLIT = { imageW: 2576, imageH: 1449, left: 0.4075, width: 0.185, top: 0.2595 };
  const scene = $("[data-scene]");
  function placeSlit() {
    const w = scene.clientWidth, h = scene.clientHeight;
    if (!w || !h) return;                            // «Главная» скрыта — пересчитаем, когда откроется
    const scale = Math.max(w / SLIT.imageW, h / SLIT.imageH);
    const offsetX = (w - SLIT.imageW * scale) / 2;
    const offsetY = (h - SLIT.imageH * scale) / 2;
    scene.style.setProperty("--slit-x", `${offsetX + SLIT.left * SLIT.imageW * scale}px`);
    scene.style.setProperty("--slit-w", `${SLIT.width * SLIT.imageW * scale}px`);
    scene.style.setProperty("--slit-y", `${offsetY + SLIT.top * SLIT.imageH * scale}px`);
  }
  placeSlit();
  if ("ResizeObserver" in window) new ResizeObserver(placeSlit).observe(scene);
  else window.addEventListener("resize", placeSlit);

  // Главная: приветствие по времени суток, кнопка с именем мастера (открывает чат), две фразы.
  const user = inTelegram && tg.initDataUnsafe && tg.initDataUnsafe.user;
  const homeBox = $(".home");
  const greetingEl = $("[data-greeting]");

  // Приветствие по часам телефона (интервалы — в data.greetings), с именем из Telegram, если оно есть.
  function greetingText() {
    const hour = new Date().getHours();
    const g = data.greetings.find((x) => (x.from < x.to ? hour >= x.from && hour < x.to : hour >= x.from || hour < x.to));
    const name = user && user.first_name ? `, ${user.first_name}` : "";
    return `${g ? g.text : data.greetings[0].text}${name}!`;
  }
  // Каждая буква — отдельный элемент: так ей можно дать свою задержку вспышки.
  // Слова не разрываются; программам чтения с экрана — целая фраза в aria-label.
  function renderGreeting() {
    const text = greetingText();
    greetingEl.dataset.shown = text;
    greetingEl.setAttribute("aria-label", text);
    greetingEl.innerHTML = text.split(" ")
      .map((word) => `<span class="word" aria-hidden="true">${[...word].map((ch) => `<span class="ch">${esc(ch)}</span>`).join("")}</span>`)
      .join(" ");
  }
  // Свет идёт из центра щели: буквы ближе к центру загораются раньше и сохраняют тёплый отсвет (--g),
  // нижняя строка — чуть позже верхней.
  function aimLight() {
    const box = greetingEl.getBoundingClientRect();
    if (!box.width) return false;                   // «Главная» скрыта
    const center = box.left + box.width / 2;
    const half = box.width / 2;
    greetingEl.querySelectorAll(".ch").forEach((ch) => {
      const r = ch.getBoundingClientRect();
      const dist = Math.min(1, Math.abs(r.left + r.width / 2 - center) / half);
      const line = Math.round((r.top - box.top) / r.height);
      ch.style.setProperty("--d", `${(0.45 + dist * 0.6 + line * 0.14).toFixed(3)}s`);
      ch.style.setProperty("--g", ((1 - dist) ** 2).toFixed(3));
    });
    return true;
  }
  // Проиграть появление заново: свет зажигает приветствие, потом появляются кнопка и текст.
  function playHome() {
    if (!aimLight()) return;
    homeBox.classList.remove("play");
    void homeBox.offsetWidth;                       // перезапуск CSS-анимаций
    homeBox.classList.toggle("lite-play", root.classList.contains("lite"));
    homeBox.classList.add("play");
  }
  renderGreeting();
  // Наступило другое время суток — новое приветствие.
  setInterval(() => {
    if (greetingText() === greetingEl.dataset.shown) return;
    renderGreeting();
    playHome();
  }, 30000);
  // Когда шрифт загрузится, буквы встанут на свои места — пересчитываем отсвет.
  if (document.fonts) document.fonts.ready.then(aimLight);

  const nameButton = $("[data-name-button]");
  nameButton.innerHTML = `${icons.telegram}<span>${esc(data.name)}</span>`;
  nameButton.setAttribute("aria-label", `${data.name} — написать в Telegram`);
  // Липкие нити (sticky-arm.js) — короче, чем на сайте: на маленьком экране не тянутся через полстраницы.
  // near — с какого расстояния нити начинают тянуться (доля ширины кнопки), *Break — на какой длине рвутся, px.
  // На слабом телефоне нитей меньше: 7 центральных и 4 боковые вместо 13 и 10.
  let threadsPaused = false;                         // true, пока открыто окно-оффер
  function mountThreads() {
    if (!window.StickyArmButton || threadsPaused) return;
    threadsPaused = true;
    if (nameButton.__sab) nameButton.__sab.destroy();
    const lite = root.classList.contains("lite");
    window.StickyArmButton.mount(nameButton, Object.assign(
      { near: 0.4, coreBreak: [90, 135], sideBreak: [65, 105] },
      lite ? { core: 7, side: 4, segs: 16 } : {},
    ));
  }
  mountThreads();
  liteListeners.push(mountThreads);
  $("[data-lead]").innerHTML = nbsp(data.home.lead);
  $("[data-text]").innerHTML = nbsp(data.home.text);
  $("[data-home-services]").innerHTML = `${icons.services}<span>${esc(data.home.servicesButton)}</span>`;
  $("[data-home-portfolio]").innerHTML = `${icons.portfolio}<span>${esc(data.home.portfolioButton)}</span>`;
  $("[data-share]").innerHTML = `${icons.share}<span>${esc(data.share.button)}</span>`;

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
  $("[data-services-next]").innerHTML = `${icons.portfolio}<span>${esc(data.servicesNext)}</span>`;
  if (data.discount) $("[data-discount]").textContent = data.discount;
  else $("[data-discount]").remove();

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
    { action: "share", icon: icons.share, title: data.share.button, sub: data.share.hint },
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
    if (target.dataset.tab || target === themeToggle) return;   // меню и переключатель темы — свои обработчики
    // Кнопки-переходы («Услуги и цены», «Мои работы», «Посмотреть работы») — как кнопки меню.
    if (target.dataset.go) { haptic.select(); show(target.dataset.go); return; }
    haptic.tap();
    // Поделиться — сразу: системное «Поделиться» и буфер обмена браузер разрешает только в момент нажатия.
    if (target.hasAttribute("data-share") || target.dataset.contact === "share") { shareBot(); return; }
    // Почта копируется сразу: браузер разрешает доступ к буферу обмена только в момент нажатия.
    if (target.dataset.contact === "email") { copyEmail(); return; }
    // Ссылки открываются с паузой 0,26 с — чтобы успело мелькнуть мерцание кнопки.
    const later = (fn) => setTimeout(fn, calm.matches ? 0 : 260);
    if (target.dataset.discuss) later(() => openTelegram(data.services[target.dataset.discuss].message));
    else if (target.hasAttribute("data-discuss-project")) later(() => openTelegram("Здравствуйте! Хочу обсудить проект."));
    else if (target.dataset.openWork) later(() => openLink(data.portfolio[target.dataset.openWork].url));
    else if (target.hasAttribute("data-telegram-button") || target.hasAttribute("data-name-button")) later(() => openTelegram());
    else if (target.dataset.contact === "telegram") later(() => openTelegram());
    else if (target.dataset.contact === "instagram") later(() => openLink(`https://instagram.com/${data.instagram}`));
  });
  // Любая кнопка при нажатии коротко мерцает тёплым светом (анимация flicker в styles.css).
  // Слушаем в фазе перехвата — до остальных обработчиков, чтобы мерцание шло и у меню, и у переключателя темы.
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || performance.now() - swipe.blockClick < 350) return;   // после свайпа — не нажатие
    button.classList.remove("flicker");
    void button.offsetWidth;                         // перезапуск, если нажали снова, пока мерцает
    button.classList.add("flicker");
    clearTimeout(button.flickerTimer);
    button.flickerTimer = setTimeout(() => button.classList.remove("flicker"), 500);
  }, true);
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
    settleSwipe();                                   // свайп ещё доезжает — сначала закончить его
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
    if (name === "home") playHome();             // приветствие загорается заново

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
  // Открыта заявка — «Назад» закрывает её; иначе — на «Главную».
  if (supports("6.1")) tg.BackButton.onClick(() => (leadBox.hidden ? show("home") : closeLead()));

  // ============================================================
  // Свайпы: влево — следующий экран, вправо — предыдущий (в порядке кнопок меню)
  // ============================================================
  // Как в нативных приложениях: оба экрана — текущий и соседний — едут за пальцем 1:1,
  // соседний выезжает сбоку вплотную. Отпустил дальше трети ширины или взмахом — переход;
  // иначе экраны возвращаются. После отпускания движение продолжается с той скоростью,
  // с какой шёл палец, и плавно замедляется. На первом и последнем экране — «резинка».
  // Вертикальную прокрутку браузер ведёт сам (touch-action: pan-y), поэтому свайп начинается,
  // только если палец идёт заметно больше вбок, чем вниз.
  const screensBox = $(".screens");
  const swipe = { id: null, active: false, x0: 0, y0: 0, x: 0, dir: 0, peer: null, samples: [], anims: [], pending: null, blockClick: -Infinity };
  const place = (el, x) => { el.style.transform = `translate3d(${x}px, 0, 0)`; };
  const unplace = (el) => { el.style.transform = ""; el.style.willChange = ""; };
  // Если предыдущий свайп ещё доезжает — сразу к концу.
  function settleSwipe() {
    if (!swipe.pending) return;
    swipe.anims.forEach((a) => a.cancel());
    swipe.anims = [];
    const done = swipe.pending;
    swipe.pending = null;
    done();
  }
  // Показать соседний экран с нужной стороны (dir: 1 — следующий, −1 — предыдущий).
  function preparePeer(dir) {
    if (swipe.dir === dir) return;
    if (swipe.peer) { swipe.peer.hidden = true; unplace(swipe.peer); }
    swipe.dir = dir;
    const name = order[order.indexOf(current) + dir];
    swipe.peer = name ? screens[name] : null;
    if (!swipe.peer) return;
    swipe.peer.hidden = false;
    swipe.peer.inert = true;                                 // пока едет — не ловит касания
    swipe.peer.scrollTop = 0;
    swipe.peer.style.willChange = "transform";
    if (name === "home") playHome();                         // приветствие загорается, пока «Главная» выезжает
  }
  screensBox.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;                   // мышью листают меню, а не экран
    if (e.target.closest(".sab-btn")) return;                // с кнопки с именем палец тянет нити
    if (e.clientX < 20 || e.clientX > window.innerWidth - 20) return;   // у краёв — системный жест «назад»
    settleSwipe();
    Object.assign(swipe, { id: e.pointerId, active: false, x0: e.clientX, y0: e.clientY, x: 0, dir: 0, peer: null, samples: [] });
  });
  screensBox.addEventListener("pointermove", (e) => {
    if (e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x0, dy = e.clientY - swipe.y0;
    if (!swipe.active) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.3) { swipe.id = null; return; }   // это прокрутка вниз-вверх
      swipe.active = true;
      running.forEach((a) => a.finish());                    // недоигранный переход по меню — сразу к концу
      screens[current].style.willChange = "transform";
    }
    preparePeer(dx < 0 ? 1 : -1);
    const W = screensBox.clientWidth;
    // Есть сосед — экран идёт точно за пальцем; нет — тянется туго, всё слабее с расстоянием.
    swipe.x = swipe.peer ? dx : dx / (1 + Math.abs(dx) / (W * 0.25)) * 0.5;
    place(screens[current], swipe.x);
    if (swipe.peer) place(swipe.peer, swipe.x + swipe.dir * W);
    swipe.samples.push({ t: e.timeStamp, x: e.clientX });
    if (swipe.samples.length > 6) swipe.samples.shift();
  });
  function endSwipe(e) {
    if (e.pointerId !== swipe.id) return;
    swipe.id = null;
    if (!swipe.active) return;
    swipe.blockClick = performance.now();                    // палец отпустили над кнопкой — это не нажатие
    // Скорость пальца в последние ~0,1 с, px/мс (со знаком: минус — влево).
    const last = swipe.samples[swipe.samples.length - 1];
    const first = swipe.samples.find((p) => last && last.t - p.t < 100) || last;
    const v = last && first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const W = screensBox.clientWidth;
    const from = screens[current], peer = swipe.peer, dir = swipe.dir, x = swipe.x;
    const go = e.type === "pointerup" && peer &&
      (Math.abs(x) > W * 0.3 || (Math.abs(v) > 0.3 && Math.sign(v) === -dir));
    const end = go ? -dir * W : 0;                           // где окажется текущий экран
    // Время — по оставшемуся пути и скорости пальца: быстрый взмах доезжает быстро.
    const speed = Math.max(Math.abs(v), 1);
    const duration = calm.matches ? 0 : Math.round(Math.min(420, Math.max(200, (Math.abs(end - x) / speed) * 1.8)));
    const ease = "cubic-bezier(0.22, 0.9, 0.3, 1)";
    const done = () => {
      unplace(from);
      if (go) {
        from.hidden = true;
        from.inert = true;
        unplace(peer);
        peer.inert = false;
        current = order[order.indexOf(current) + dir];
        updateMenu();
      } else if (peer) {
        peer.hidden = true;
        unplace(peer);
      }
    };
    if (go) haptic.select();
    place(from, end);
    if (peer) place(peer, end + dir * W);
    if (!duration || !from.animate) { done(); return; }
    swipe.anims = [from.animate([{ transform: `translate3d(${x}px, 0, 0)` }, { transform: `translate3d(${end}px, 0, 0)` }], { duration, easing: ease })];
    if (peer) swipe.anims.push(peer.animate([{ transform: `translate3d(${x + dir * W}px, 0, 0)` }, { transform: `translate3d(${end + dir * W}px, 0, 0)` }], { duration, easing: ease }));
    swipe.pending = done;
    swipe.anims[0].onfinish = settleSwipe;
    setTimeout(settleSwipe, duration + 40);                  // запасной путь, если браузер приостановил анимацию
  }
  screensBox.addEventListener("pointerup", endSwipe);
  screensBox.addEventListener("pointercancel", endSwipe);
  // После свайпа браузер может посчитать отпускание пальца нажатием на кнопку под ним — гасим такое нажатие.
  document.addEventListener("click", (e) => {
    if (performance.now() - swipe.blockClick < 350) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Открыть сразу нужный экран: в Telegram — ссылкой t.me/<бот>/<приложение>?startapp=services,
  // в браузере — адресом tg-app/#services.
  const start = (inTelegram && tg.initDataUnsafe.start_param) || location.hash.slice(1);
  if (start && screens[start] && start !== "home") {
    screens.home.hidden = true;
    screens[start].hidden = false;
    current = start;
  }
  updateMenu();
  if (current === "home") playHome();

  // ============================================================
  // Оффер: окно поверх приложения при первом открытии, один раз
  // ============================================================
  // Что показано, запоминается в localStorage (ключ offerSeen) — в хранилище браузера на этом телефоне.
  // Запоминается сразу при показе: закрыл приложение, не нажав ничего, — второй раз окно не появится.
  // Для проверки: адрес с ?offer=1 показывает окно всегда.
  const offer = data.offer;
  const offerBox = $("[data-offer]");
  const OFFER_KEY = "offerSeen";
  const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  $("[data-offer-emoji]").textContent = offer.emoji;
  $("[data-offer-title]").innerHTML = nbsp(offer.title);
  $("[data-offer-text]").innerHTML = nbsp(offer.text);
  $("[data-offer-label]").textContent = offer.label;
  $("[data-offer-list]").innerHTML = offer.bullets.map((b) => `<li>${checkIcon}<span>${nbsp(b)}</span></li>`).join("");
  $("[data-offer-cta]").innerHTML = `${icons.telegram}<span>${esc(offer.button)}</span>`;
  $("[data-offer-skip]").textContent = offer.skip;

  const behind = [$(".screens"), $(".tabbar"), themeToggle];   // пока окно открыто, приложение под ним недоступно
  let lastFocus = null;
  function openOffer() {
    try { localStorage.setItem(OFFER_KEY, "1"); } catch { /* хранилище недоступно — покажется ещё раз, не страшно */ }
    lastFocus = document.activeElement;
    behind.forEach((el) => { el.inert = true; });
    // Нити рисуются на холсте поверх всей страницы — и поверх окна тоже. Пока окно открыто, выключаем их совсем.
    if (nameButton.__sab) nameButton.__sab.destroy();
    offerBox.hidden = false;
    $("[data-offer-cta]").focus({ preventScroll: true });
    haptic.tap();
  }
  function closeOffer() {
    if (offerBox.hidden || offerBox.classList.contains("is-closing")) return;
    behind.forEach((el) => { el.inert = false; });
    threadsPaused = false;
    mountThreads();                                   // окно закрыто — нити снова работают
    const finish = () => { offerBox.hidden = true; offerBox.classList.remove("is-closing"); };
    if (calm.matches) finish();
    else { offerBox.classList.add("is-closing"); setTimeout(finish, 230); }
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  $("[data-offer-cta]").addEventListener("click", () => {
    setTimeout(() => {                                // мерцание кнопки успевает мелькнуть
      if (inTelegram) tg.openTelegramLink(offer.url);
      else window.open(offer.url, "_blank", "noopener");
      closeOffer();
    }, calm.matches ? 0 : 200);
  });
  offerBox.querySelectorAll("[data-offer-close]").forEach((el) => el.addEventListener("click", closeOffer));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!welcomeBox.hidden) closeWelcome();
    else closeOffer();
  });

  let offerSeen = false;
  try { offerSeen = localStorage.getItem(OFFER_KEY) === "1"; } catch { /* нет хранилища — считаем, что не видел */ }
  if (offer.enabled === false) offerSeen = true;          // окно выключено в data.js
  if (new URLSearchParams(location.search).get("offer") === "1") offerSeen = false;
  // Окно — после того как приложение показалось и приветствие загорелось (~1,4 с), а не поверх пустого экрана.
  // Если сначала показано окно «Привет», оффер ждёт, пока его закроют кнопкой «Начать».
  const scheduleOffer = () => { if (!offerSeen) setTimeout(openOffer, calm.matches ? 300 : 1400); };

  // ============================================================
  // Заявка: окно поверх приложения
  // ============================================================
  // Открывается кнопкой «Оставить заявку» на экране «Связаться». Заявка уходит на сервер (data.lead.apiUrl)
  // и сразу приходит владельцу в Telegram. В Telegram к запросу прикладывается подписанная строка initData —
  // по ней сервер узнаёт клиента, и владелец может ответить ему через бота.
  const leadCfg = data.lead;
  const leadBox = $("[data-lead-sheet]");
  const leadForm = $("[data-lead-form]");
  const leadFields = leadForm.elements;
  const leadError = leadForm.querySelector(".lead-error");
  const leadSubmit = $("[data-lead-submit]");
  const leadDone = $("[data-lead-done]");
  // Проверка на Mac (npm run server): запросы — на тот же адрес, что и страница.
  const leadApi = ["localhost", "127.0.0.1"].includes(location.hostname) ? "/api/leads" : leadCfg.apiUrl;

  $("[data-lead-open]").innerHTML = `${icons.mail}<span>${esc(leadCfg.button)}</span>`;
  $("[data-lead-title]").textContent = leadCfg.title;
  $("[data-lead-text]").innerHTML = nbsp(leadCfg.text);
  leadBox.querySelectorAll("[data-lead-close]").forEach((b) => { b.textContent = leadCfg.close; });
  leadSubmit.innerHTML = `<span>${esc(leadCfg.submit)}</span>`;
  const leadOption = (value, label) => Object.assign(document.createElement("option"), { value, textContent: label });
  leadFields.serviceId.append(leadOption("", "Выберите…"));
  data.services.forEach((service) => leadFields.serviceId.append(leadOption(service.id, service.title)));
  leadFields.serviceId.append(leadOption("other", leadCfg.otherService));
  Object.entries(leadCfg.budgets).forEach(([v, label]) => leadFields.budget.append(leadOption(v, label)));
  Object.entries(leadCfg.deadlines).forEach(([v, label]) => leadFields.deadline.append(leadOption(v, label)));
  Object.entries(leadCfg.methods).forEach(([v, m]) => leadFields.contactMethod.append(leadOption(v, m.label)));

  // В Telegram имя и ник подставляются сами; без ника ответить можно по Telegram ID, поле контакта необязательно.
  const tgUsername = user && user.username ? `@${user.username}` : "";
  if (user && user.first_name) leadFields.name.value = user.first_name.trim();
  function updateLeadContact() {
    const method = leadCfg.methods[leadFields.contactMethod.value];
    leadFields.contact.type = method.type;
    leadFields.contact.placeholder = method.placeholder;
    leadFields.contact.autocomplete = method.autocomplete;
    if (leadFields.contactMethod.value === "telegram" && inTelegram && !leadFields.contact.value) leadFields.contact.value = tgUsername;
    leadFields.contact.setCustomValidity("");
  }
  leadFields.contactMethod.addEventListener("change", () => {
    if (leadFields.contactMethod.value !== "telegram" && leadFields.contact.value === tgUsername) leadFields.contact.value = "";
    updateLeadContact();
  });
  updateLeadContact();

  // Те же правила, что на сервере (server/lib/leads.mjs).
  const leadChecks = {
    serviceId: () => (leadFields.serviceId.value ? "" : "Выберите, что нужно сделать."),
    task: () => (leadFields.task.value.trim().length >= 3 ? "" : "Опишите задачу хотя бы парой слов."),
    name: () => (leadFields.name.value.trim() ? "" : "Напишите, как вас зовут."),
    contact: () => {
      const value = leadFields.contact.value.trim();
      const method = leadFields.contactMethod.value;
      if (!value) return method === "telegram" && inTelegram ? "" : "Укажите, как с вами связаться.";
      if (method === "telegram" && !/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value)) return "Укажите ник в Telegram, например @username.";
      if (method === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Укажите корректную почту.";
      if (method === "phone") {
        const digits = value.replace(/\D/g, "").length;
        if (!/^\+?[\d\s()-]+$/.test(value) || digits < 7 || digits > 15) return "Укажите номер телефона, например +7 999 123-45-67.";
      }
      return "";
    },
    consent: () => (leadFields.consent.checked ? "" : "Нужно ваше согласие, иначе я не смогу принять заявку."),
  };
  Object.keys(leadChecks).forEach((name) => {
    leadFields[name].addEventListener(["consent", "serviceId"].includes(name) ? "change" : "input", () => leadFields[name].setCustomValidity(""));
  });

  function openLead() {
    lastFocus = document.activeElement;
    behind.forEach((el) => { el.inert = true; });
    threadsPaused = true;
    if (nameButton.__sab) nameButton.__sab.destroy();   // нити рисуются поверх всего — пока окно открыто, их нет
    leadError.hidden = true;
    if (!leadDone.hidden) {                            // после отправленной заявки — снова пустая форма
      leadDone.hidden = true;
      leadForm.hidden = false;
      leadForm.reset();
      if (user && user.first_name) leadFields.name.value = user.first_name.trim();
      updateLeadContact();
    }
    leadBox.hidden = false;
    leadBox.scrollTop = 0;
    if (supports("6.1")) tg.BackButton.show();
    leadFields.serviceId.focus({ preventScroll: true });
  }
  function closeLead() {
    if (leadBox.hidden) return;
    leadBox.hidden = true;
    behind.forEach((el) => { el.inert = false; });
    threadsPaused = false;
    mountThreads();
    updateMenu();                                     // кнопка «Назад» — как было до окна
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  $("[data-lead-open]").addEventListener("click", () => setTimeout(openLead, calm.matches ? 0 : 160));
  leadBox.querySelectorAll("[data-lead-close]").forEach((b) => b.addEventListener("click", closeLead));
  $("[data-lead-privacy]").addEventListener("click", () => openLink(leadCfg.privacyUrl));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLead(); });

  // Разрешить боту писать клиенту — чтобы владелец мог ответить на заявку через бота.
  // Telegram сам спрашивает человека; если уже разрешено или версия старая — сразу дальше.
  function askWriteAccess() {
    if (!inTelegram || (user && user.allows_write_to_pm) || !supports("6.9")) return Promise.resolve(false);
    return new Promise((resolve) => tg.requestWriteAccess((granted) => resolve(Boolean(granted))));
  }

  leadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    leadError.hidden = true;
    Object.entries(leadChecks).forEach(([name, check]) => leadFields[name].setCustomValidity(check()));
    if (!leadForm.reportValidity()) return;

    leadSubmit.disabled = true;
    leadSubmit.innerHTML = `<span>${esc(leadCfg.sending)}</span>`;
    try {
      const writeAccess = await askWriteAccess();
      const headers = { "Content-Type": "application/json" };
      if (inTelegram) headers.Authorization = `tma ${tg.initData}`;
      const body = {
        serviceId: leadFields.serviceId.value,
        task: leadFields.task.value.trim(),
        budget: leadFields.budget.value,
        deadline: leadFields.deadline.value,
        name: leadFields.name.value.trim(),
        contactMethod: leadFields.contactMethod.value,
        contact: leadFields.contact.value.trim(),
        consent: leadFields.consent.checked,
        website: leadFields.website.value,
      };
      if (inTelegram) body.writeAccess = writeAccess;
      const response = await fetch(leadApi, { method: "POST", headers, body: JSON.stringify(body) });
      let result = {};
      try { result = await response.json(); } catch { /* ответ не JSON — общее сообщение */ }
      if (!response.ok) {
        leadError.textContent = result.error || "Не получилось отправить заявку. Попробуйте ещё раз или напишите мне в Telegram.";
        leadError.hidden = false;
        return;
      }
      haptic.success();
      leadForm.hidden = true;
      $("[data-lead-done-title]").textContent = leadCfg.thanksTitle.replace("{number}", result.number);
      $("[data-lead-done-text]").innerHTML = nbsp(inTelegram ? leadCfg.thanksText : leadCfg.thanksTextNoBot);
      leadDone.hidden = false;
      leadBox.scrollTop = 0;
    } catch {
      leadError.textContent = `Нет связи с сервером. Проверьте интернет или напишите мне в Telegram: @${data.telegram}.`;
      leadError.hidden = false;
    } finally {
      leadSubmit.disabled = false;
      leadSubmit.innerHTML = `<span>${esc(leadCfg.submit)}</span>`;
    }
  });

  // ============================================================
  // Приветствие: экран при первом открытии, один раз
  // ============================================================
  // «Привет, <имя из Telegram>!», что здесь можно сделать и кнопка «Начать». Тексты — data.welcome.
  // Что показано, запоминается в localStorage (ключ welcomeSeen). Для проверки: адрес с ?welcome=1 показывает всегда.
  const welcome = data.welcome;
  const welcomeBox = $("[data-welcome]");
  const WELCOME_KEY = "welcomeSeen";
  const firstName = user && user.first_name ? user.first_name.trim() : "";
  $("[data-welcome-title]").textContent = firstName ? `${welcome.hello}, ${firstName}!` : `${welcome.hello}!`;
  $("[data-welcome-text]").innerHTML = nbsp(welcome.text);
  $("[data-welcome-list]").innerHTML = welcome.points
    .map((p) => `<li><span class="row-icon">${icons[p.icon] || ""}</span><span>${nbsp(p.text)}</span></li>`)
    .join("");
  $("[data-welcome-start]").innerHTML = `<span>${esc(welcome.button)}</span>`;

  function openWelcome() {
    try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* хранилище недоступно — покажется ещё раз, не страшно */ }
    behind.forEach((el) => { el.inert = true; });
    if (nameButton.__sab) nameButton.__sab.destroy();   // нити рисуются поверх всего — пока окно открыто, их нет
    welcomeBox.hidden = false;
    $("[data-welcome-start]").focus({ preventScroll: true });
  }
  function closeWelcome() {
    if (welcomeBox.hidden || welcomeBox.classList.contains("is-closing")) return;
    behind.forEach((el) => { el.inert = false; });
    threadsPaused = false;
    mountThreads();
    if (current === "home") playHome();               // приветствие на «Главной» загорается уже на виду
    const finish = () => { welcomeBox.hidden = true; welcomeBox.classList.remove("is-closing"); };
    if (calm.matches) finish();
    else { welcomeBox.classList.add("is-closing"); setTimeout(finish, 320); }
    scheduleOffer();
  }
  $("[data-welcome-start]").addEventListener("click", () => {
    setTimeout(closeWelcome, calm.matches ? 0 : 160);  // мерцание кнопки успевает мелькнуть
  });

  let welcomeSeen = false;
  try { welcomeSeen = localStorage.getItem(WELCOME_KEY) === "1"; } catch { /* нет хранилища — считаем, что не видел */ }
  if (new URLSearchParams(location.search).get("welcome") === "1") welcomeSeen = false;
  if (welcomeSeen) scheduleOffer();
  else openWelcome();
})();
