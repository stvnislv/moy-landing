// Липкие нити — копия скрипта Sticky Arm Button с сайта (index.html).
// Из кнопки с атрибутом data-sticky-arm к пальцу (или курсору) тянутся чёрные липкие нити;
// отпустил — нити рвутся и втягиваются. Короткий тап работает как обычное нажатие.
// Цвет нитей задаётся в styles.css переменными --sab-strand и --sab-strand-hl.
// Если меняете поведение нитей на сайте — перенесите правки и сюда.
/* ==========================================================
   Sticky Arm Button
   Когда курсор подходит к кнопке, из её края к нему тянутся
   липкие нити: плотный пучок по центру стороны, обращённой
   к курсору, и вялые боковые нити, которые цепляются за
   центральные и обвиваются вокруг них. Если отвести курсор,
   нити истончаются, по очереди рвутся и втягиваются в кнопку.

   Использование:
     <a class="sab-btn" data-sticky-arm href="...">Текст</a>
     + CSS из sticky-arm-button.css и этот скрипт в конце body.
   Кнопки с data-sticky-arm подключаются автоматически.
   Вручную: StickyArmButton.mount(element, { ...настройки })
   ========================================================== */
(function (global) {
  'use strict';

  // ---------- Настройки ----------
  const DEFAULTS = {
    near: 0.6,              // зона срабатывания: доля ширины кнопки от её края
    core: 13,               // нитей в центральном пучке
    side: 10,               // боковых нитей
    segs: 22,               // точек в нити
    coreWidth: [1.1, 4.4],  // толщина центральных нитей, px
    sideWidth: [0.45, 1.9], // толщина боковых, px
    coreSpread: 0.16,       // разброс центральных нитей по стороне (доля стороны)
    coreBreak: [190, 300],  // длина, на которой рвутся центральные нити, px
    sideBreak: [140, 250],  // ...боковые рвутся раньше
    leadMs: 140,            // первая нить долетает до курсора
    coreGrowMs: 150,
    coreDelayMs: [40, 220],
    sideGrowMs: 420,        // боковые тянутся медленнее
    sideDelayMs: [180, 520],
    respawnMs: 260,         // через сколько оторванная нить может прилипнуть снова
    braid: 0.32,            // как сильно боковые нити липнут к центральным
    twist: 3.2,             // радиус переплетения вокруг центральной нити, px
    gravity: 0.13,
    damping: 0.9,
    slack: 1.045,
    tremble: 0.2,
    recoil: 0.9,            // скорость втягивания оторванной нити (меньше = быстрее)
    color: '#111',
    maxArc: 0.5,            // максимальная длина стороны, откуда растут нити (доля контура в каждую сторону)
    shape: null,            // свой контур вместо капсулы: { contour(g), inside(g, x, y), clip(ctx, g) }
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  function mount(btn, opts) {
    if (!btn || btn.__sab) return btn && btn.__sab;
    const C = Object.assign({}, DEFAULTS, opts || {});
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return (btn.__sab = { destroy() {} });

    const root = document.documentElement;
    const cv = document.createElement('canvas');
    cv.className = 'sab-canvas';
    cv.setAttribute('aria-hidden', 'true');
    document.body.append(cv);
    const ctx = cv.getContext('2d');

    let W = 0, H = 0;
    function resize() {
      // на больших экранах (iMac 5K и т. п.) ограничиваем плотность холста — меньше работы видеокарте
      let dpr = Math.min(devicePixelRatio || 1, 2);
      const px = innerWidth * innerHeight;
      if (px * dpr * dpr > 6e6) dpr = Math.max(1, Math.sqrt(6e6 / px));
      W = innerWidth; H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    const mouse = { x: -1e4, y: -1e4 };
    let touch = null, suppressClick = false;
    let drips = [], drops = [];
    let raf = 0;

    // ---------- геометрия капсулы ----------
    function geom() {
      const r = btn.getBoundingClientRect();
      return { l: r.left, t: r.top, w: r.width, h: r.height,
               x: r.left + r.width / 2, y: r.top + r.height / 2, hw: r.width / 2, hh: r.height / 2 };
    }
    // Форма может быть любой: по умолчанию капсула кнопки, но через opts.shape можно передать
    // свой контур (например, силуэт портрета): { contour(g), inside(g, x, y), clip(ctx, g) }.
    function contour(g, N) {
      if (C.shape) return C.shape.contour(g, N);
      const r = g.hh, L = Math.max(0, g.w - 2 * r), P = 2 * L + 2 * Math.PI * r, out = [];
      for (let i = 0; i < N; i++) {
        let d = (i / N) * P, x, y, nx, ny;
        if (d < L) { x = g.l + r + d; y = g.t; nx = 0; ny = -1; }
        else if ((d -= L) < Math.PI * r) { const a = -Math.PI / 2 + d / r; x = g.l + r + L + Math.cos(a) * r; y = g.y + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
        else if ((d -= Math.PI * r) < L) { x = g.l + r + L - d; y = g.t + g.h; nx = 0; ny = 1; }
        else { d -= L; const a = Math.PI / 2 + d / r; x = g.l + r + Math.cos(a) * r; y = g.y + Math.sin(a) * r; nx = Math.cos(a); ny = Math.sin(a); }
        out.push({ x, y, nx, ny });
      }
      return out;
    }
    // Сторона кнопки, обращённая к курсору. Возвращает функцию: доля f ∈ [0..1] → точка чуть под краем.
    // Центр стороны (f = 0.5) — точка края, ближайшая к курсору.
    function facingSide(g) {
      const pts = contour(g, 180), N = pts.length;
      const face = pts.map(p => (mouse.x - p.x) * p.nx + (mouse.y - p.y) * p.ny > 0);
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.hypot(mouse.x - p.x, mouse.y - p.y); if (d < bd) { bd = d; best = i; } });
      let a = 0, b = 0; // сколько точек стороны слева и справа от ближайшей
      const all = face.every(Boolean) || !face.some(Boolean);
      if (all) { a = b = N / 4; }
      else {
        const lim = N * C.maxArc;   // для сложных контуров (силуэт) сторона ограничена
        while (a < lim && face[((best - a - 1) % N + N) % N]) a++;
        while (b < lim && face[(best + b + 1) % N]) b++;
        a = Math.max(a, 6); b = Math.max(b, 6);
      }
      return f => {
        const t = f < 0.5 ? best - (0.5 - f) * 2 * a * 0.96 : best + (f - 0.5) * 2 * b * 0.96;
        const i0 = Math.floor(t), k = t - i0;
        const p = pts[((i0 % N) + N) % N], q = pts[(((i0 + 1) % N) + N) % N];
        const nx = p.nx + (q.nx - p.nx) * k, ny = p.ny + (q.ny - p.ny) * k;
        return { x: p.x + (q.x - p.x) * k - nx * 3, y: p.y + (q.y - p.y) * k - ny * 3 };
      };
    }
    function edgeDist(g) {
      let bd = Infinity;
      for (const p of contour(g, 90)) bd = Math.min(bd, Math.hypot(mouse.x - p.x, mouse.y - p.y));
      const inside = C.shape ? C.shape.inside(g, mouse.x, mouse.y) : Math.abs(mouse.x - g.x) < g.hw - g.hh
        ? Math.abs(mouse.y - g.y) < g.hh
        : Math.hypot(Math.abs(mouse.x - g.x) - (g.hw - g.hh), mouse.y - g.y) < g.hh;
      return inside ? -bd : bd;
    }
    function pill(g) {
      if (C.shape) return C.shape.clip(ctx, g);
      const r = g.hh;
      ctx.moveTo(g.l + r, g.t);
      ctx.lineTo(g.l + g.w - r, g.t);
      ctx.arc(g.l + g.w - r, g.y, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(g.l + r, g.t + g.h);
      ctx.arc(g.l + r, g.y, r, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
    }

    // ---------- нити ----------
    // Слоты фиксированы: 0..core-1 — центральные (0 — первая, «ведущая»), дальше боковые.
    const strands = [];
    for (let i = 0; i < C.core + C.side; i++) {
      const core = i < C.core;
      strands.push({
        core, lead: i === 0, idx: i,
        state: 'dead', diedAt: -1e9,
        pts: [], A: { x: 0, y: 0 }, tip: { x: 0, y: 0 },
      });
    }
    const cores = strands.filter(s => s.core);

    function spawn(s, now, side, first) {
      const sideRight = s.idx % 2 === 0;
      s.f = s.core
        ? (s.lead ? 0.5 : clamp(0.5 + gauss() * C.coreSpread * 1.6, 0.26, 0.74))
        : (sideRight ? rand(0.7, 0.98) : rand(0.02, 0.3));
      s.w = s.core ? rand(C.coreWidth[0], C.coreWidth[1]) : rand(C.sideWidth[0], C.sideWidth[1]);
      if (s.core && Math.random() < 0.25) s.w = rand(C.coreWidth[0], C.coreWidth[0] + 0.8); // немного тонких и в центре
      s.ox = s.lead ? 0 : rand(-5, 5); s.oy = s.lead ? 0 : rand(-5, 5);
      s.brk = s.core ? rand(C.coreBreak[0], C.coreBreak[1]) * (0.85 + s.w / 14) : rand(C.sideBreak[0], C.sideBreak[1]);
      s.born = now;
      s.delay = s.lead || !first ? (s.lead ? 0 : rand(0, 120)) : s.core ? rand(C.coreDelayMs[0], C.coreDelayMs[1]) : rand(C.sideDelayMs[0], C.sideDelayMs[1]);
      s.dur = s.lead ? C.leadMs : s.core ? C.coreGrowMs : C.sideGrowMs;
      s.seed = rand(0, 1000);
      s.merge = Math.floor(C.segs * rand(0.3, 0.55));   // где боковая нить прилипает к центральной
      s.phase = rand(0, Math.PI * 2); s.freq = rand(0.55, 0.95); s.spin = rand(-1, 1) < 0 ? -1 : 1;
      // фактура: неровная толщина по длине
      s.prof = []; const ph1 = rand(0, 6), ph2 = rand(0, 6), f1 = rand(0.5, 0.9), f2 = rand(1.3, 2.2);
      for (let j = 0; j <= C.segs; j++) s.prof.push(1 + 0.22 * Math.sin(j * f1 + ph1) + 0.14 * Math.sin(j * f2 + ph2));
      s.bead = s.w > 2 && Math.random() < 0.55 ? { t: rand(0.25, 0.75), r: rand(0.55, 0.85) } : null;
      const a = side(s.f);
      s.A.x = a.x; s.A.y = a.y; s.tip.x = a.x; s.tip.y = a.y;
      s.pts = [];
      for (let j = 0; j <= C.segs; j++) s.pts.push({ x: a.x, y: a.y, px: a.x, py: a.y });
      s.rest = 0; s.tension = 0;
      // не даём нити сразу порваться, если курсор уже далеко от её края
      const D0 = Math.hypot(mouse.x - a.x, mouse.y - a.y);
      s.brk = Math.max(s.brk, D0 * (s.core ? 1.8 : 1.5));
      s.state = 'grow';
    }

    function detach(s, now) {
      if (s.state !== 'grow' && s.state !== 'live') return;
      s.state = 'recoil';
      s.anchor = { x: s.A.x, y: s.A.y };
      const last = s.pts.length - 1;
      s.rest = Math.hypot(s.pts[last].x - s.pts[0].x, s.pts[last].y - s.pts[0].y) / C.segs;
      // упругая отдача: свободная часть получает скорость к кнопке
      for (let j = 1; j <= last; j++) {
        const p = s.pts[j], k = (j / last) * 0.1;
        p.px = p.x - (s.anchor.x - p.x) * k;
        p.py = p.y - (s.anchor.y - p.y) * k;
      }
      // на курсоре остаётся капля, она падает и исчезает
      if (s.tension > 0.6) drops.push({ x: s.pts[last].x, y: s.pts[last].y, vx: 0, vy: 0.5, r: Math.max(0.8, s.w * 0.6), born: now });
      // боковые нити, прилипшие к этой, тоже отрываются
      if (s.core) for (const o of strands) if (!o.core && o.host === s) detach(o, now);
    }
    function releaseAll(now) { for (const s of strands) detach(s, now); if (strands.some(s => s.state === 'recoil')) wake(); }

    // ---------- физика (верле) ----------
    function integrate(pts, pinA, pinB) {
      const last = pts.length - 1;
      for (let i = 0; i <= last; i++) {
        if ((i === 0 && pinA) || (i === last && pinB)) continue;
        const p = pts[i];
        const vx = (p.x - p.px) * C.damping, vy = (p.y - p.py) * C.damping;
        p.px = p.x; p.py = p.y;
        p.x += vx; p.y += vy + C.gravity;
      }
    }
    function constrain(pts, rest, A, B, iters) {
      const last = pts.length - 1;
      for (let it = 0; it < iters; it++) {
        if (A) { pts[0].x = A.x; pts[0].y = A.y; }
        if (B) { pts[last].x = B.x; pts[last].y = B.y; }
        for (let i = 0; i < last; i++) {
          const p = pts[i], q = pts[i + 1];
          const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1e-4;
          const diff = (d - rest) / d;
          const fp = i === 0 && A, fq = i + 1 === last && B;
          const wp = fp ? 0 : (fq ? 1 : 0.5), wq = fq ? 0 : (fp ? 1 : 0.5);
          p.x += dx * diff * wp; p.y += dy * diff * wp;
          q.x -= dx * diff * wq; q.y -= dy * diff * wq;
        }
      }
      if (A) { pts[0].px = pts[0].x = A.x; pts[0].py = pts[0].y = A.y; }
      if (B) { pts[last].px = pts[last].x = B.x; pts[last].py = pts[last].y = B.y; }
    }
    function tremble(s, now, amp) {
      const a = s.pts[0], b = s.pts[C.segs];
      let nx = -(b.y - a.y), ny = b.x - a.x;
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      for (let j = 1; j < C.segs; j++) {
        const env = Math.sin(Math.PI * j / C.segs);
        const n = Math.sin(now * 0.011 + s.seed + j * 0.8) * 0.6 + Math.sin(now * 0.027 + s.seed * 1.3 + j * 1.7) * 0.4;
        s.pts[j].x += nx * n * amp * env;
        s.pts[j].y += ny * n * amp * env;
      }
    }
    // Боковая нить после точки прилипания тянется к центральной и обвивается вокруг неё спиралью
    function braid(s, now) {
      const h = s.host.pts, last = C.segs;
      for (let j = s.merge; j < last; j++) {
        const hp = h[j], hq = h[Math.min(j + 1, last)];
        let tx = hq.x - hp.x, ty = hq.y - hp.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const fade = 1 - (j - s.merge) / (last - s.merge) * 0.7;          // ближе к курсору виток плотнее
        const ang = j * s.freq * 2.2 + s.phase + now * 0.002 * s.spin;
        const off = Math.sin(ang) * C.twist * fade;
        const gx = hp.x - ty * off, gy = hp.y + tx * off;
        const k = C.braid * clamp((j - s.merge + 1) / 3, 0, 1);           // мягкий вход в переплетение
        s.pts[j].x += (gx - s.pts[j].x) * k;
        s.pts[j].y += (gy - s.pts[j].y) * k;
      }
    }

    // ---------- отрисовка: лента переменной толщины + блик ----------
    function ribbon(pts, widthAt) {
      const n = pts.length, L = [], R = [];
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x, ty = b.y - a.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const hw = widthAt(i) / 2;
        L.push({ x: pts[i].x - ty * hw, y: pts[i].y + tx * hw });
        R.push({ x: pts[i].x + ty * hw, y: pts[i].y - tx * hw });
      }
      ctx.beginPath();
      ctx.moveTo(L[0].x, L[0].y);
      for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(L[i].x, L[i].y, (L[i].x + L[i + 1].x) / 2, (L[i].y + L[i + 1].y) / 2);
      ctx.lineTo(L[n - 1].x, L[n - 1].y);
      ctx.lineTo(R[n - 1].x, R[n - 1].y);
      for (let i = n - 2; i > 0; i--) ctx.quadraticCurveTo(R[i].x, R[i].y, (R[i].x + R[i - 1].x) / 2, (R[i].y + R[i - 1].y) / 2);
      ctx.lineTo(R[0].x, R[0].y);
      ctx.closePath();
      ctx.fill();
      // скруглённые концы
      for (const i of [0, n - 1]) { ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, widthAt(i) / 2, 0, Math.PI * 2); ctx.fill(); }
      return { L, R };
    }
    function curve(pts, from, to) {
      ctx.beginPath();
      ctx.moveTo(pts[from].x, pts[from].y);
      for (let i = from + 1; i < to; i++) ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
      ctx.lineTo(pts[to].x, pts[to].y);
    }
    function pointAt(pts, t) {
      const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), k = f - i;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    function drawStrand(s, col, hl) {
      const n = s.pts.length - 1;
      for (const p of s.pts) grow(p.x, p.y, s.w * 2 + 6);
      const t = s.tension;
      const neck = clamp((t - 0.72) / 0.28, 0, 1);              // перед разрывом нить «вытягивается» и истончается
      const recoil = s.state === 'recoil';
      const widthAt = i => {
        const u = i / n;
        let k = s.prof[Math.min(i, s.prof.length - 1)];
        k *= 1.25 - 0.55 * Math.sin(Math.PI * u) * (0.6 + 0.6 * t); // толще у концов, тоньше в середине при натяжении
        if (!recoil && neck > 0) k *= 1 - 0.75 * neck * clamp((u - 0.55) / 0.45, 0, 1);
        return Math.max(0.35, s.w * k);
      };
      ctx.fillStyle = col;
      ribbon(s.pts, widthAt);
      // глянцевый блик на толстых нитях
      if (s.w > 1.5) {
        ctx.save();
        ctx.strokeStyle = hl;
        ctx.lineWidth = Math.max(0.5, s.w * 0.2);
        ctx.translate(-s.w * 0.18, -s.w * 0.22);
        curve(s.pts, 1, n - 1);
        ctx.stroke();
        ctx.restore();
      }
      // капля-бусина на нити
      if (s.bead && !recoil) {
        const p = pointAt(s.pts, s.bead.t);
        const r = s.w * s.bead.r * (1 - 0.4 * t) + 0.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hl;
        ctx.beginPath(); ctx.arc(p.x - r * 0.35, p.y - r * 0.4, r * 0.32, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col;
      }
      // при отдаче на свободном конце — капля
      if (recoil) {
        const e = s.pts[n];
        ctx.beginPath(); ctx.arc(e.x, e.y, s.w * 0.75 + 0.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // участок экрана, где в этом кадре что-то нарисовано
    let dirty = null;
    function grow(x, y, m) {
      if (!dirty) dirty = { x0: x - m, y0: y - m, x1: x + m, y1: y + m };
      else { dirty.x0 = Math.min(dirty.x0, x - m); dirty.y0 = Math.min(dirty.y0, y - m); dirty.x1 = Math.max(dirty.x1, x + m); dirty.y1 = Math.max(dirty.y1, y + m); }
    }
    // цвета нитей читаются из CSS один раз и обновляются только при смене темы
    let colorCache = null;
    function strandColors() {
      if (!colorCache) {
        const cs = getComputedStyle(btn);
        colorCache = { col: cs.getPropertyValue('--sab-strand').trim() || C.color,
                       hl: cs.getPropertyValue('--sab-strand-hl').trim() || 'rgba(255,255,255,.3)' };
      }
      return colorCache;
    }
    new MutationObserver(() => { colorCache = null; }).observe(root, { attributes: true, attributeFilter: ['class'] });
    // ---------- кадр ----------
    // Анимация работает только пока есть что рисовать. В покое цикл полностью остановлен,
    // а будит его движение курсора рядом с кнопкой — так страница не нагружает процессор.
    let prev = performance.now(), running = false;
    function wake() {
      if (running) return;
      running = true; prev = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function frame(now) {
      const dt = Math.min(50, now - prev); prev = now;
      const g = geom();
      const de = edgeDist(g);
      const near = C.near * g.w;
      const side = facingSide(g);

      // курсор рядом — прилипают все свободные нити (ведущая первой)
      const anyAlive = strands.some(s => s.state !== 'dead');
      if (de < near && mouse.x > -1e3) {
        const first = !anyAlive;
        for (const s of strands) {
          if (s.state !== 'dead' || now - s.diedAt < C.respawnMs) continue;
          if (!s.core) {
            const live = cores.filter(c => c.state === 'grow' || c.state === 'live');
            if (!live.length) continue;
            // боковая цепляется за одну из центральных — чаще за ближайшую к её стороне
            s.host = live[Math.floor(Math.random() * live.length)];
          }
          if (!first && s.lead) { spawn(s, now, side, false); continue; }
          spawn(s, now, side, first);
        }
      }

      // стираем только участок, где нити были в прошлом кадре, а не весь экран
      if (dirty) ctx.clearRect(dirty.x0, dirty.y0, dirty.x1 - dirty.x0, dirty.y1 - dirty.y0);
      dirty = null;
      const busy = strands.some(s => s.state !== 'dead') || drips.length || drops.length;
      // всё втянулось и курсор далеко — засыпаем
      if (!busy && !(de < near * 1.5 && mouse.x > -1e3)) { running = false; return; }
      raf = requestAnimationFrame(frame);
      if (!busy) return;

      const { col, hl } = strandColors();
      ctx.save();

      // 1) центральные, 2) боковые (им нужна уже посчитанная центральная)
      for (const pass of [true, false]) for (const s of strands) {
        if (s.core !== pass || s.state === 'dead') continue;

        if (s.state === 'recoil') {
          // оторвалась: держится только за кнопку, укорачивается и пружинит обратно
          s.rest *= C.recoil;
          integrate(s.pts, true, false);
          constrain(s.pts, s.rest, s.anchor, null, 6);
          s.tension = 0;
          if (s.rest < 0.35) {
            s.state = 'dead'; s.diedAt = now;
            if (s.anchor.y > g.y + g.hh * 0.25 && Math.random() < 0.5)
              drips.push({ x: s.anchor.x - g.l, y: s.anchor.y - g.t, born: now, max: rand(7, 20), w: Math.max(0.9, s.w * 0.7), seed: rand(0, 100) });
            continue;
          }
          drawStrand(s, col, hl);
          continue;
        }

        // место выхода плавно скользит по стороне, обращённой к курсору
        const tA = side(s.f);
        s.A.x += (tA.x - s.A.x) * 0.22; s.A.y += (tA.y - s.A.y) * 0.22;
        const goal = { x: mouse.x + s.ox, y: mouse.y + s.oy };

        // рост: центральные летят прямо к курсору, боковые — сначала к центральной нити, потом вдоль неё
        const k = easeOut(clamp((now - s.born - s.delay) / s.dur, 0, 1));
        if (k <= 0) { s.tip.x = s.A.x; s.tip.y = s.A.y; continue; }
        if (s.core) {
          const wig = s.lead && k < 1 ? Math.sin(k * 14 + s.seed) * 6 * (1 - k) : 0;
          const dx = goal.x - s.A.x, dy = goal.y - s.A.y, dl = Math.hypot(dx, dy) || 1;
          s.tip.x = s.A.x + dx * k - dy / dl * wig;
          s.tip.y = s.A.y + dy * k + dx / dl * wig;
        } else {
          const hm = s.host.pts[s.merge];
          if (k < 0.45) { const q = k / 0.45; s.tip.x = s.A.x + (hm.x - s.A.x) * q; s.tip.y = s.A.y + (hm.y - s.A.y) * q; }
          else { const p = pointAt(s.host.pts, s.merge / C.segs + (1 - s.merge / C.segs) * (k - 0.45) / 0.55); s.tip.x = p.x; s.tip.y = p.y; }
          if (k >= 1) { s.tip.x = goal.x; s.tip.y = goal.y; }
        }
        if (k >= 1) s.state = 'live';

        const D = Math.hypot(s.tip.x - s.A.x, s.tip.y - s.A.y);
        // натяжение по реальной длине до курсора
        s.tension = s.state === 'live' ? Math.hypot(goal.x - s.A.x, goal.y - s.A.y) / s.brk : 0;
        if (s.tension > 1) { detach(s, now); drawStrand(s, col, hl); continue; }

        integrate(s.pts, true, true);
        if (!s.core && s.state === 'live') braid(s, now);
        constrain(s.pts, Math.max(0.01, D / C.segs * C.slack), s.A, s.tip, 7);
        tremble(s, now, C.tremble * (s.core ? 1 : 0.6));
        drawStrand(s, col, hl);
      }

      // подтёки на кромке — следы втянувшихся нитей
      drips = drips.filter(d => {
        const t = now - d.born;
        if (t > 1700) return false;
        const L = t < 300 ? easeOut(t / 300) : t < 1000 ? 1 : 1 - Math.pow(clamp((t - 1000) / 700, 0, 1), 2);
        const ex = g.l + d.x, ey = g.t + d.y;
        grow(ex, ey + d.max / 2, d.max + 8);
        const len = d.max * L, sway = Math.sin(now * 0.004 + d.seed) * 1.4 * L;
        ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.ellipse(ex, ey, d.w * 2.2, d.w * 1.3 + 1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = d.w;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.quadraticCurveTo(ex + sway * 0.3, ey + len * 0.6, ex + sway, ey + len); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex + sway, ey + len, d.w * 0.9 + 0.5, 0, Math.PI * 2); ctx.fill();
        return true;
      });
      // капли, оставшиеся на курсоре после разрыва
      drops = drops.filter(d => {
        const t = now - d.born;
        if (t > 650) return false;
        d.vy += 0.25 * dt / 16; d.x += d.vx; d.y += d.vy * dt / 16;
        ctx.globalAlpha = 1 - t / 650;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r * (1 - t / 900), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        grow(d.x, d.y, d.r + 4);
        return true;
      });
      // под кнопкой нитей не видно: вырезаем её форму (дешевле, чем маска на весь экран)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); pill(g); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    // ---------- события ----------
    function nearButton(x, y) {
      const r = btn.getBoundingClientRect(), pad = r.width * C.near * 1.5;
      return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
    }
    const onMove = e => {
      if (e.pointerType === 'mouse') {
        mouse.x = e.clientX; mouse.y = e.clientY;
        if (!running && nearButton(mouse.x, mouse.y)) wake();
      }
      else if (touch && e.pointerId === touch.id) {
        mouse.x = e.clientX; mouse.y = e.clientY;
        if (Math.hypot(e.clientX - touch.x0, e.clientY - touch.y0) > 10) touch.moved = true;
      }
    };
    // Телефон: касание кнопки выпускает нити, они тянутся за пальцем; отпустил — отрываются.
    // Короткий тап открывает ссылку, перетаскивание — нет.
    const onDown = e => {
      if (e.pointerType === 'mouse') return;
      touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
      suppressClick = false;
      mouse.x = e.clientX; mouse.y = e.clientY;
      wake();
    };
    const onUp = e => {
      if (!touch || e.pointerId !== touch.id) return;
      suppressClick = touch.moved;
      touch = null;
      releaseAll(performance.now());
      mouse.x = mouse.y = -1e4;
    };
    const onClick = e => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; } };
    const onMenu = e => { if (touch) e.preventDefault(); };
    const onLeave = () => { releaseAll(performance.now()); mouse.x = mouse.y = -1e4; };
    const onBlur = () => releaseAll(performance.now());
    addEventListener('pointermove', onMove, { passive: true });
    btn.addEventListener('pointerdown', onDown);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp);
    btn.addEventListener('click', onClick, true);
    btn.addEventListener('contextmenu', onMenu);
    root.addEventListener('mouseleave', onLeave);
    addEventListener('blur', onBlur);
    addEventListener('resize', resize);

    return (btn.__sab = {
      destroy() {
        cancelAnimationFrame(raf); running = false;
        removeEventListener('pointermove', onMove);
        btn.removeEventListener('pointerdown', onDown);
        removeEventListener('pointerup', onUp);
        removeEventListener('pointercancel', onUp);
        btn.removeEventListener('click', onClick, true);
        btn.removeEventListener('contextmenu', onMenu);
        root.removeEventListener('mouseleave', onLeave);
        removeEventListener('blur', onBlur);
        removeEventListener('resize', resize);
        cv.remove();
        delete btn.__sab;
      },
    });
  }

  function auto() { document.querySelectorAll('[data-sticky-arm]').forEach(b => mount(b)); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();

  global.StickyArmButton = { mount, defaults: DEFAULTS };
})(window);

