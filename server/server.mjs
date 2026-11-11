// API-сервер для VPS: node:http без зависимостей. Перед ним стоит Caddy (https, статика сайта),
// сюда он проксирует только /api/*. Для проверки на Mac может сам отдавать статику (STATIC_ROOT).
//
// Запуск на Mac из корня проекта:
//   export PATH=~/.local/node/bin:$PATH
//   npm run server            — то же, что node --env-file=.env server/server.mjs
// Нужны в .env: STORAGE_DRIVER=file, STORAGE_DIR=<абсолютный путь>, TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID,
// ALLOWED_ORIGINS (для проверки на Mac добавить http://localhost:3000), IP_HASH_SALT.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLeadHandler } from "./handlers/leads.mjs";
import { jsonResponse } from "./lib/http.mjs";

const MAX_BODY_BYTES = 64 * 1024;

/** Маршруты API: путь → обработчик (request, { ip, env }) → Response. */
export const routes = {
  "/api/leads": createLeadHandler,
  "/api/health": async () => jsonResponse({ ok: true }),
};

// Что можно отдавать как статику (только при STATIC_ROOT). Всё остальное в папке проекта закрыто.
const STATIC_FILES = /^\/(index\.html|hero-bg\.jpg|privacy\.html|tg-app\/(?!CLAUDE\.md)[\w.-]+(\/[\w.-]+)*)$/;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

class BodyTooLargeError extends Error {}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** IP клиента. За Caddy (TRUST_PROXY=1) — первый адрес из X-Forwarded-For, иначе адрес соединения. */
export function clientIp(req, env = process.env) {
  if (env.TRUST_PROXY === "1") {
    const forwarded = req.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? null;
}

async function serveStatic(root, pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    decoded = "";
  }
  if (!STATIC_FILES.test(decoded) || decoded.includes("..")) return false;
  const file = path.join(root, decoded);
  if (!file.startsWith(root + path.sep)) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function send(res, response) {
  const headers = Object.fromEntries(response.headers);
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function createServer(env = process.env) {
  const staticRoot = env.STATIC_ROOT ? path.resolve(env.STATIC_ROOT) : null;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const handler = routes[url.pathname];

      if (!handler) {
        if (staticRoot && req.method === "GET" && await serveStatic(staticRoot, url.pathname, res)) return;
        await send(res, jsonResponse({ error: "Не найдено." }, 404));
        return;
      }

      const hasBody = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const request = new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers,
        body: hasBody ? await readBody(req) : undefined,
      });
      await send(res, await handler(request, { ip: clientIp(req, env), env }));
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        await send(res, jsonResponse({ error: "Запрос слишком большой." }, 413));
        return;
      }
      // В лог — только тип и текст ошибки, без тела запроса и данных клиента.
      console.error("Ошибка обработки запроса:", req.method, req.url?.split("?")[0], error?.message);
      if (!res.headersSent) await send(res, jsonResponse({ error: "Внутренняя ошибка сервера. Попробуйте позже." }, 500));
      else res.end();
    }
  });
}

/** Проверка настроек при запуске: лучше упасть сразу, чем на первой заявке. */
export function checkEnv(env = process.env) {
  const problems = [];
  if (env.STORAGE_DRIVER !== "file") problems.push("STORAGE_DRIVER должен быть file");
  if (!env.STORAGE_DIR || !path.isAbsolute(env.STORAGE_DIR)) problems.push("STORAGE_DIR — абсолютный путь к папке данных");
  for (const name of ["TELEGRAM_BOT_TOKEN", "OWNER_TELEGRAM_ID", "ALLOWED_ORIGINS", "IP_HASH_SALT"]) {
    if (!env[name]?.trim()) problems.push(`не задан ${name}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkEnv();
  if (problems.length) {
    console.error(`Сервер не запущен. Проверьте .env:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = createServer();
  server.listen(port, host, () => console.log(`API слушает http://${host}:${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
